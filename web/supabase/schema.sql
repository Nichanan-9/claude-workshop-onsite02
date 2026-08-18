-- ============================================================================
-- Golden Dragon Restaurant (โรงเตี๊ยมมังกรทอง) — booking database schema
-- ============================================================================
--
-- HOW TO APPLY THIS FILE
--   1. Open the Supabase dashboard for this project.
--   2. Go to  SQL Editor  ->  New query.
--   3. Paste this ENTIRE file and press Run.
--   4. Re-running it later is safe: every statement is idempotent
--      (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS first).
--   The SQL Editor runs as a superuser-ish role (`postgres`), which is what
--   makes the SECURITY DEFINER functions below own the right privileges.
--
-- WHAT THIS FILE CREATES
--   tables     time_slots, closed_dates, bookings, booking_attempt
--   type       booking_status (enum: pending | confirmed | cancelled)
--   sequence   booking_ref_seq
--   functions  seats_per_slot(), next_booking_ref(), slot_availability(date),
--              book_slot(...), prune_booking_attempts()
--
-- SECURITY POSTURE IN ONE PARAGRAPH
--   `bookings` holds real personal data (Thai names and phone numbers). RLS is
--   on for every table and the anonymous role has NO table privileges on
--   `bookings` at all — it cannot SELECT, INSERT, UPDATE or DELETE, with or
--   without a policy. The only two things anon may do are call
--   `book_slot(...)` (SECURITY DEFINER, inserts on its behalf) and call
--   `slot_availability(date)` (SECURITY DEFINER, returns aggregate counts
--   only). Signed-in staff may read all bookings and may UPDATE only the
--   `status` column, enforced by a column-level GRANT because RLS cannot
--   restrict columns. Nothing here relies on the BYPASSRLS secret key: the
--   customer path works with the publishable key.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
-- gen_random_uuid() lives in pgcrypto on older servers; on PG13+ it is built
-- in. The IF NOT EXISTS keeps this a no-op either way.
create extension if not exists pgcrypto with schema extensions;


-- ----------------------------------------------------------------------------
-- Capacity constant
-- ----------------------------------------------------------------------------
-- AUTHORITATIVE seat capacity per (date, slot). The database is the authority,
-- because the database is the only place where the capacity check can actually
-- be enforced atomically (see book_slot below). `SEATS_PER_SLOT = 40` in
-- web/src/lib/restaurant.ts is a MIRROR of this value, used only to render
-- "seats remaining" hints in the UI; if you change the number, change it in
-- both places, and change it HERE FIRST. A function (rather than a config
-- table) is used so there is exactly one literal `40` in the whole schema and
-- both book_slot and slot_availability read it.
create or replace function public.seats_per_slot()
returns integer
language sql
immutable
-- SECURITY INVOKER (the default): touches no tables, so there is nothing to
-- elevate for. A definer function here would add privilege risk for no gain.
set search_path = ''
as $$ select 40 $$;

comment on function public.seats_per_slot() is
  'Authoritative per-slot seat capacity. Mirrored (not owned) by SEATS_PER_SLOT in web/src/lib/restaurant.ts.';


-- ----------------------------------------------------------------------------
-- Lookup table: the 12 valid time slots
-- ----------------------------------------------------------------------------
-- A lookup table rather than a CHECK constraint listing 12 strings, so the slot
-- menu has ONE definition that both (a) validates bookings, via a foreign key,
-- and (b) drives the availability read path, which must return a row for every
-- slot including ones nobody has booked. TIME_SLOTS in web/src/lib/booking.ts
-- mirrors these rows for rendering order.
create table if not exists public.time_slots (
  slot       text    primary key,
  sort_order integer not null unique
);

insert into public.time_slots (slot, sort_order) values
  ('11:00',  1),
  ('11:30',  2),
  ('12:00',  3),
  ('12:30',  4),
  ('13:00',  5),
  ('17:00',  6),
  ('17:30',  7),
  ('18:00',  8),
  ('18:30',  9),
  ('19:00', 10),
  ('19:30', 11),
  ('20:00', 12)
on conflict (slot) do nothing;


-- ----------------------------------------------------------------------------
-- Lookup table: one-off closure dates
-- ----------------------------------------------------------------------------
-- Mirrors CLOSED_DATES in web/src/lib/restaurant.ts (currently empty). Not a
-- day-of-week rule — the kitchen serves every day — just hand-added holidays.
-- Rows are added by staff through the dashboard / a privileged path, never by
-- the app, so there is no write policy for anon or authenticated below.
create table if not exists public.closed_dates (
  closed_date date primary key,
  reason      text
);


-- ----------------------------------------------------------------------------
-- Booking status
-- ----------------------------------------------------------------------------
-- A real enum rather than a CHECK-constrained text: staff UPDATE the status
-- column directly, and an enum makes an invalid value impossible rather than
-- merely rejected by a constraint someone might later drop. Seats are held
-- from `pending` onward; only `cancelled` frees them.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'booking_status' and n.nspname = 'public'
  ) then
    create type public.booking_status as enum ('pending', 'confirmed', 'cancelled');
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- Human-facing booking reference: CN-XXXXXX
-- ----------------------------------------------------------------------------
-- THE DATABASE OWNS THE REFERENCE. The prototype's generateBookingId() in
-- web/src/lib/booking.ts picks a random 6-digit number client-side, which can
-- collide (and, being client-supplied, can be chosen by the caller). Instead a
-- sequence produces it here, so uniqueness is structural rather than lucky.
-- The app should stop generating one and display the `booking_ref` that
-- book_slot returns.
--
-- Trade-off accepted: sequential references are guessable and leak booking
-- volume. That is harmless here because there is no customer-facing read path
-- at all — knowing a reference grants nothing, since anon cannot SELECT
-- bookings under any circumstances.
--
-- 100000..999999 keeps the reference exactly 6 digits. NO CYCLE: if the
-- restaurant ever takes 900k bookings, exhausting the sequence raises a loud
-- error instead of silently reusing an old reference.
create sequence if not exists public.booking_ref_seq
  as bigint start with 100000 increment by 1 minvalue 100000 maxvalue 999999 no cycle;

create or replace function public.next_booking_ref()
returns text
language sql
volatile
-- SECURITY INVOKER: only touches a sequence. It is called from inside
-- book_slot (which is definer and therefore already runs as the owner), so it
-- needs no privileges of its own.
set search_path = ''
as $$ select 'CN-' || lpad(nextval('public.booking_ref_seq')::text, 6, '0') $$;


-- ----------------------------------------------------------------------------
-- bookings
-- ----------------------------------------------------------------------------
create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),

  -- Unique even though the DB generates it: the constraint is the thing that
  -- makes "generated, never colliding" true rather than merely intended.
  booking_ref    text not null unique
                   constraint bookings_ref_format check (booking_ref ~ '^CN-[0-9]{6}$')
                   default public.next_booking_ref(),

  booking_date   date not null,

  -- FK to the lookup table: the 12 valid slot strings are defined once.
  time_slot      text not null references public.time_slots (slot),

  party_size     smallint not null
                   constraint bookings_party_size_range check (party_size between 1 and 12),

  -- Length caps bound abuse independently of anything the app validates.
  customer_name  text not null
                   constraint bookings_name_not_empty
                     check (char_length(btrim(customer_name)) between 1 and 120),

  -- Stored normalised to digits only (book_slot strips separators), so the
  -- per-phone rate limit and staff call-backs both key off one canonical form.
  customer_phone text not null
                   constraint bookings_phone_format check (customer_phone ~ '^[0-9]{9,10}$'),

  note           text
                   constraint bookings_note_length check (note is null or char_length(note) <= 500),

  status         public.booking_status not null default 'pending',

  created_at     timestamptz not null default now()
);

-- The capacity aggregation in book_slot is exactly
--   where booking_date = ? and time_slot = ? and status <> 'cancelled'
-- so this partial index covers it precisely and stays small: cancelled rows,
-- which are irrelevant to capacity, are not indexed at all. party_size is
-- INCLUDEd so the sum is answered index-only.
create index if not exists bookings_capacity_idx
  on public.bookings (booking_date, time_slot)
  include (party_size)
  where status <> 'cancelled';

-- Supports the per-phone daily rate limit and staff lookup by phone.
create index if not exists bookings_phone_created_idx
  on public.bookings (customer_phone, created_at desc);

-- The /admin list is "today forward, newest first".
create index if not exists bookings_date_slot_idx
  on public.bookings (booking_date desc, time_slot);


-- ----------------------------------------------------------------------------
-- booking_attempt — rate limiting, in Postgres (no Redis)
-- ----------------------------------------------------------------------------
-- One row per call to book_slot, successful or not, which is what makes the
-- per-IP limit meaningful: a flood of *rejected* attempts is exactly the thing
-- being throttled, so counting only successes would be useless.
--
-- IMPLEMENTED LIMITS (both enforced inside book_slot, before any insert):
--   * per IP    : at most 10 attempts per rolling 60 minutes, any outcome.
--   * per phone : at most 3 SUCCESSFUL bookings per calendar day, where the
--                 day boundary is midnight in Asia/Bangkok, not UTC.
--
-- IMPORTANT — the IP is only as trustworthy as the app makes it. Postgres
-- cannot see the client's IP; `inet_client_addr()` is the Supabase pooler, not
-- the customer. So the app must read it from the request headers
-- (x-forwarded-for / x-real-ip) and pass it in as p_client_ip. Two consequences:
--   1. Call book_slot from a SERVER ACTION, never from the browser. A browser
--      caller could pass any string it liked and rotate it per request,
--      defeating the per-IP limit entirely.
--   2. x-forwarded-for is client-supplied upstream of the platform; trust only
--      the hop your host guarantees (on Vercel, the left-most entry is
--      rewritten to the real peer). Treat this limit as friction against
--      casual abuse, not as an authentication boundary.
create table if not exists public.booking_attempt (
  id           bigint generated always as identity primary key,
  client_ip    text,
  phone        text,
  outcome      text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists booking_attempt_ip_time_idx
  on public.booking_attempt (client_ip, attempted_at desc)
  where client_ip is not null;

create index if not exists booking_attempt_phone_time_idx
  on public.booking_attempt (phone, attempted_at desc);

-- Attempts are pruned by age. 7 days is comfortably longer than the widest
-- window either limit looks back over (1 hour / 1 Bangkok calendar day), so
-- pruning can never delete a row a live limit still needs, while leaving a
-- short forensic trail if someone hammers the endpoint.
create or replace function public.prune_booking_attempts()
returns integer
language plpgsql
volatile
security definer
-- DEFINER: booking_attempt has no policies (see RLS section) so an ordinary
-- caller cannot delete from it; this function is the sanctioned way. Its
-- search_path is pinned to '' with every name schema-qualified below, which is
-- the documented mitigation for definer-function search_path hijacking.
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.booking_attempt
  where attempted_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;


-- ----------------------------------------------------------------------------
-- Availability read path (the only thing the public UI may read)
-- ----------------------------------------------------------------------------
-- Returns, for one date, aggregate seat counts per slot — and NOTHING ELSE.
-- No name, no phone, no note, no booking_ref, no row count, no id.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT A VIEW:
--   A view could work — a view's underlying-table access is checked against
--   the view OWNER unless it is declared security_invoker — but a definer
--   function is the better tool here for three reasons.
--   1. Explicitness. "This function deliberately reads a table its caller
--      cannot" is stated in the function's own definition; with a view the
--      same privilege hop is implicit in who happens to own the view, which is
--      easy to break later by recreating it as security_invoker.
--   2. search_path. A definer function can pin `set search_path = ''`. A view
--      has no equivalent knob.
--   3. Shape. The date is a required argument, so a caller cannot ask for
--      "every slot on every date" in one round trip and mine the result for
--      timing patterns; and the function can return the derived is_past /
--      is_closed flags alongside the counts.
--   The residual leak is inherent to publishing availability at all: a caller
--   can watch counts change over time and infer that *someone* booked N seats.
--   That is aggregate-only and unavoidable for any booking UI.
drop function if exists public.slot_availability(date);

create or replace function public.slot_availability(p_date date)
returns table (
  slot            text,
  seats_taken     integer,
  seats_remaining integer,
  is_past         boolean,
  is_closed       boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.slot,
    coalesce(sum(b.party_size), 0)::integer as seats_taken,
    greatest(0, public.seats_per_slot() - coalesce(sum(b.party_size), 0))::integer as seats_remaining,
    -- `date + time` yields a timestamp WITHOUT time zone, and
    -- `now() at time zone 'Asia/Bangkok'` yields the Bangkok wall clock in the
    -- same form, so this compares like with like. Doing it in UTC would keep
    -- offering lunch slots that were served seven hours ago.
    (p_date + t.slot::time) < (now() at time zone 'Asia/Bangkok') as is_past,
    exists (select 1 from public.closed_dates c where c.closed_date = p_date) as is_closed
  from public.time_slots t
  left join public.bookings b
    on b.booking_date = p_date
   and b.time_slot = t.slot
   and b.status <> 'cancelled'
  group by t.slot, t.sort_order
  order by t.sort_order
$$;

comment on function public.slot_availability(date) is
  'Aggregate per-slot seat counts for one date. Exposes no personal data. Feed seats_taken into buildSlotAvailability() in web/src/lib/restaurant.ts.';


-- ----------------------------------------------------------------------------
-- book_slot — the ONLY way a booking is created
-- ----------------------------------------------------------------------------
-- Returns jsonb so the app can branch on a machine-readable code instead of
-- parsing error text. `status` is always present; other keys depend on it:
--
--   {"status":"ok","booking_ref":"CN-100042","seats_remaining":34}
--   {"status":"slot_full","seats_remaining":3}          <- ordinary control flow
--   {"status":"slot_closed"}
--   {"status":"slot_past"}
--   {"status":"invalid_slot"}
--   {"status":"invalid_party_size"}
--   {"status":"invalid_name"}
--   {"status":"invalid_phone"}
--   {"status":"invalid_note"}
--   {"status":"rate_limited_ip","retry_after_seconds":1234}
--   {"status":"rate_limited_phone"}
--
-- `slot_full` is NOT an exception. It is the expected outcome of a race the
-- design deliberately allows (there are no temporary seat holds), so raising
-- would (a) force the app to string-match an error and (b) roll back the
-- booking_attempt row this call needs to leave behind for rate limiting.
--
-- WHY THE ADVISORY LOCK IS REQUIRED (not paranoia):
--   The check is "sum existing party sizes for this (date, slot), then insert
--   only if the sum stays within capacity". Under READ COMMITTED two
--   concurrent transactions both read the old sum and both insert, overselling
--   the room. REPEATABLE READ does not save us either: the two inserts are two
--   different new rows and conflict on nothing, so no serialization failure is
--   raised. And a UNIQUE constraint cannot express it, because party size is
--   variable. So the lock is the mechanism.
--   pg_advisory_XACT_lock (never the session-scoped pg_advisory_lock) is used
--   because a transaction-level lock is released automatically at transaction
--   end. A plpgsql body runs inside a single implicit transaction, so the lock
--   is confined to this one call — which is what makes it safe behind
--   Supabase's transaction-mode pooler, where a session-scoped lock could leak
--   onto an unrelated client that reuses the backend.
drop function if exists public.book_slot(date, text, integer, text, text, text, text);

create or replace function public.book_slot(
  p_date       date,
  p_slot       text,
  p_party_size integer,
  p_name       text,
  p_phone      text,
  p_note       text default null,
  p_client_ip  text default null
)
returns jsonb
language plpgsql
volatile
security definer
-- DEFINER, deliberately: anon has zero privileges on public.bookings and
-- public.booking_attempt, and that is the point — this function is the single
-- narrow gate through which a booking can be created. Running as the owner is
-- what lets it insert on an unprivileged caller's behalf while the table stays
-- completely unreadable to that caller. `set search_path = ''` plus fully
-- schema-qualified names everywhere inside means a caller cannot shadow
-- `bookings`, `now`, or any operator with something of their own in a schema
-- they control — the documented privilege-escalation risk for definer
-- functions with a mutable search_path.
set search_path = ''
as $$
declare
  v_result       jsonb;
  v_outcome      text;
  v_phone        text;
  v_name         text;
  v_note         text;
  v_taken        integer;
  v_capacity     integer := public.seats_per_slot();
  v_ip_attempts  integer;
  v_oldest_ip    timestamptz;
  v_phone_today  integer;
  v_bangkok_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_ref          text;
begin
  -- Normalise before validating or comparing: the phone is stored and
  -- rate-limited on digits only, so '081-234-5678' and '0812345678' are one
  -- customer rather than two.
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_name  := btrim(coalesce(p_name, ''));
  v_note  := nullif(btrim(coalesce(p_note, '')), '');

  <<checks>>
  begin
    -- Cheap, lock-free rejections first. Taking the advisory lock before these
    -- would serialise every malformed request against a real one for no
    -- reason; nothing below this point can change their answers.
    if p_party_size is null or p_party_size < 1 or p_party_size > 12 then
      v_outcome := 'invalid_party_size';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    if char_length(v_name) = 0 or char_length(v_name) > 120 then
      v_outcome := 'invalid_name';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    if v_phone !~ '^[0-9]{9,10}$' then
      v_outcome := 'invalid_phone';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    if v_note is not null and char_length(v_note) > 500 then
      v_outcome := 'invalid_note';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    if p_date is null or not exists (select 1 from public.time_slots t where t.slot = p_slot) then
      v_outcome := 'invalid_slot';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    if exists (select 1 from public.closed_dates c where c.closed_date = p_date) then
      v_outcome := 'slot_closed';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    -- Past check in Bangkok wall-clock terms; see slot_availability for why
    -- both sides of this comparison are timezone-less timestamps.
    if (p_date + p_slot::time) < (now() at time zone 'Asia/Bangkok') then
      v_outcome := 'slot_past';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    -- Rate limit 1: at most 10 attempts per IP per rolling hour, any outcome.
    -- Skipped when the app passes no IP — see the booking_attempt comment;
    -- a missing IP must not become a hard failure for a legitimate customer.
    if p_client_ip is not null then
      select count(*), min(a.attempted_at)
        into v_ip_attempts, v_oldest_ip
      from public.booking_attempt a
      where a.client_ip = p_client_ip
        and a.attempted_at > now() - interval '1 hour';

      if v_ip_attempts >= 10 then
        v_outcome := 'rate_limited_ip';
        v_result := jsonb_build_object(
          'status', v_outcome,
          -- When the oldest attempt in the window ages out, a slot frees up.
          'retry_after_seconds',
          greatest(1, ceil(extract(epoch from (v_oldest_ip + interval '1 hour' - now()))))::integer
        );
        exit checks;
      end if;
    end if;

    -- Rate limit 2: at most 3 successful bookings per phone per Bangkok
    -- calendar day. Counted from booking_attempt rather than from bookings so
    -- that a booking the restaurant later cancels still counts against the
    -- day's quota — otherwise "book three, get one cancelled, book again"
    -- would be an unlimited loop.
    select count(*)
      into v_phone_today
    from public.booking_attempt a
    where a.phone = v_phone
      and a.outcome = 'ok'
      and (a.attempted_at at time zone 'Asia/Bangkok')::date = v_bangkok_today;

    if v_phone_today >= 3 then
      v_outcome := 'rate_limited_phone';
      v_result  := jsonb_build_object('status', v_outcome);
      exit checks;
    end if;

    -- ---- Capacity, under the lock ----------------------------------------
    -- Lock key: a stable 64-bit hash of (date, slot). Two callers booking the
    -- same slot serialise here; callers booking different slots never contend.
    -- hashtextextended is deterministic across sessions, unlike hashtext's
    -- historical variants, so the same (date, slot) always maps to the same
    -- key. A hash collision between two different slots costs a little
    -- needless serialisation and nothing else — it can never oversell.
    perform pg_advisory_xact_lock(hashtextextended(p_date::text || ' ' || p_slot, 0));

    select coalesce(sum(b.party_size), 0)::integer
      into v_taken
    from public.bookings b
    where b.booking_date = p_date
      and b.time_slot = p_slot
      and b.status <> 'cancelled';

    if v_taken + p_party_size > v_capacity then
      v_outcome := 'slot_full';
      v_result  := jsonb_build_object(
        'status', v_outcome,
        'seats_remaining', greatest(0, v_capacity - v_taken)
      );
      exit checks;
    end if;

    insert into public.bookings (
      booking_date, time_slot, party_size, customer_name, customer_phone, note
    )
    values (
      p_date, p_slot, p_party_size::smallint, v_name, v_phone, v_note
    )
    returning booking_ref into v_ref;

    v_outcome := 'ok';
    v_result  := jsonb_build_object(
      'status', v_outcome,
      'booking_ref', v_ref,
      'seats_remaining', v_capacity - v_taken - p_party_size
    );
  end;

  -- Every attempt is recorded, including the rejected ones — that is what the
  -- per-IP limit counts. This runs in the same transaction as the insert
  -- above, so a successful booking and its attempt row commit together.
  insert into public.booking_attempt (client_ip, phone, outcome)
  values (p_client_ip, v_phone, v_outcome);

  -- Opportunistic pruning, ~5% of calls, so the table stays bounded without a
  -- scheduler. Also callable by hand: select public.prune_booking_attempts();
  if random() < 0.05 then
    perform public.prune_booking_attempts();
  end if;

  return v_result;
end
$$;

comment on function public.book_slot(date, text, integer, text, text, text, text) is
  'The only supported way to create a booking. Returns jsonb {status: ok|slot_full|slot_closed|slot_past|invalid_*|rate_limited_*}. Call from a Server Action so p_client_ip is not caller-controlled.';


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Supabase grants privileges on new public-schema tables to `anon` and
-- `authenticated` by default, so simply omitting a policy is not enough — the
-- grants are revoked explicitly below as well. Belt and braces: RLS decides
-- which ROWS, grants decide which TABLES and COLUMNS, and personal data needs
-- both to be wrong before it leaks.

alter table public.bookings        enable row level security;
alter table public.booking_attempt enable row level security;
alter table public.time_slots      enable row level security;
alter table public.closed_dates    enable row level security;

-- ---- bookings --------------------------------------------------------------
-- anon: nothing. No SELECT (not "their own", not anyone's — there is no
-- customer-facing read path by design), no direct INSERT (book_slot only), no
-- UPDATE, no DELETE. There is intentionally no policy for anon on this table.
revoke all on table public.bookings from anon;

-- authenticated (= staff; public sign-up is disabled in the dashboard and
-- nichanan.s@jongstit.com is the only user). Read everything, and write ONLY
-- status. RLS cannot restrict columns, so the column list on the UPDATE grant
-- is what stops staff from editing a customer's name or phone; the policy
-- below grants row access, the grant narrows it to one column.
-- Upgrade path if more people ever get logins: replace `true` in these
-- policies with an explicit allow-list check, e.g. a `staff` table joined on
-- auth.uid(). Deliberately not done now — one user, no table to drift.
revoke all on table public.bookings from authenticated;
grant select on table public.bookings to authenticated;
grant update (status) on table public.bookings to authenticated;

drop policy if exists bookings_staff_select on public.bookings;
create policy bookings_staff_select
  on public.bookings
  for select
  to authenticated
  using (true);

drop policy if exists bookings_staff_update_status on public.bookings;
create policy bookings_staff_update_status
  on public.bookings
  for update
  to authenticated
  using (true)
  -- No row may be moved out of visibility by an update, and the column grant
  -- already restricts what can change; `true` is honest about that rather
  -- than implying a row filter that does not exist.
  with check (true);

-- No INSERT or DELETE policy for anyone. Inserts come from book_slot (definer,
-- runs as owner, bypasses RLS); deletions are an out-of-band admin action via
-- the dashboard. Bookings are cancelled by status, never deleted.

-- ---- booking_attempt -------------------------------------------------------
-- Zero policies and zero grants: nobody but the definer functions touches it.
-- It contains IPs and phone numbers, which is personal data in its own right.
revoke all on table public.booking_attempt from anon, authenticated;

-- ---- time_slots / closed_dates --------------------------------------------
-- Read-only reference data with nothing personal in it. Readable by everyone
-- so the UI can render the slot menu and grey out closures; writable by no
-- one through the API (maintained via the dashboard / a privileged role).
revoke all on table public.time_slots   from anon, authenticated;
revoke all on table public.closed_dates from anon, authenticated;
grant select on table public.time_slots   to anon, authenticated;
grant select on table public.closed_dates to anon, authenticated;

drop policy if exists time_slots_public_read on public.time_slots;
create policy time_slots_public_read
  on public.time_slots
  for select
  to anon, authenticated
  using (true);

drop policy if exists closed_dates_public_read on public.closed_dates;
create policy closed_dates_public_read
  on public.closed_dates
  for select
  to anon, authenticated
  using (true);

-- ---- Function execute privileges ------------------------------------------
-- Functions are EXECUTE-able by PUBLIC by default, which for a SECURITY
-- DEFINER function is exactly the mistake to avoid. Revoke, then grant to the
-- two roles that should have it.
revoke all on function public.book_slot(date, text, integer, text, text, text, text) from public;
revoke all on function public.slot_availability(date) from public;
revoke all on function public.prune_booking_attempts() from public;
revoke all on function public.next_booking_ref() from public;
revoke all on function public.seats_per_slot() from public;

grant execute on function public.book_slot(date, text, integer, text, text, text, text)
  to anon, authenticated;
grant execute on function public.slot_availability(date)
  to anon, authenticated;
grant execute on function public.seats_per_slot()
  to anon, authenticated;

-- Deliberately NOT granted to anon or authenticated:
--   prune_booking_attempts()  -- maintenance; runs from inside book_slot
--   next_booking_ref()        -- would let a caller burn reference numbers

-- Sequence privileges: nobody needs them directly. book_slot advances the
-- sequence while running as the owner.
revoke all on sequence public.booking_ref_seq from anon, authenticated;


-- ============================================================================
-- VERIFICATION QUERIES  (all commented out — uncomment and run by hand)
-- ============================================================================
--
-- 1. Structure is present and the slot menu seeded 12 rows.
--
-- select count(*) as slot_count from public.time_slots;                -- 12
-- select public.seats_per_slot() as capacity;                          -- 40
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'bookings'
--  order by ordinal_position;
--
--
-- 2. RLS is enabled on every table created here.
--
-- select relname, relrowsecurity
--   from pg_class
--  where relnamespace = 'public'::regnamespace
--    and relname in ('bookings','booking_attempt','time_slots','closed_dates');
--    -- all four rows must show relrowsecurity = true
--
-- select tablename, policyname, roles, cmd
--   from pg_policies
--  where schemaname = 'public'
--  order by tablename, policyname;
--    -- expect: bookings (staff select + staff update), time_slots read,
--    --         closed_dates read, and NOTHING for booking_attempt
--
--
-- 3. anon really cannot read bookings, and really can read availability.
--
-- select has_table_privilege('anon', 'public.bookings', 'select') as anon_can_select;  -- false
-- select has_table_privilege('anon', 'public.bookings', 'insert') as anon_can_insert;  -- false
-- select has_table_privilege('anon', 'public.booking_attempt', 'select') as anon_attempts; -- false
-- select has_function_privilege('anon', 'public.book_slot(date,text,integer,text,text,text,text)', 'execute'); -- true
-- select has_function_privilege('anon', 'public.slot_availability(date)', 'execute');  -- true
--
-- The column-level UPDATE grant for staff:
-- select column_name, privilege_type
--   from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'bookings'
--    and grantee = 'authenticated' and privilege_type = 'UPDATE';
--    -- exactly one row: status
--
--
-- 4. Every SECURITY DEFINER function has a pinned search_path.
--
-- select p.proname, p.prosecdef as is_definer, p.proconfig
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname in ('book_slot','slot_availability','prune_booking_attempts',
--                      'seats_per_slot','next_booking_ref');
--    -- every definer row must list search_path in proconfig
--
--
-- 5. Happy path, then the full-slot path. Uses tomorrow so it is never in the
--    past. Run inside a transaction and roll back to leave no test data.
--
-- begin;
--   select public.book_slot(
--     (current_date + 1), '18:00', 4,
--     'ทดสอบ ระบบ', '0812345678', 'ริมหน้าต่าง', '203.0.113.9'
--   );  -- {"status":"ok","booking_ref":"CN-1000..","seats_remaining":36}
--
--   select * from public.slot_availability(current_date + 1);
--     -- the 18:00 row shows seats_taken 4, seats_remaining 36
--
--   -- Fill the slot: 9 x 4 = 36 more seats reaches 40.
--   select public.book_slot((current_date + 1), '18:00', 4,
--            'เต็มโต๊ะ', '0898765432', null, '203.0.113.10')
--     from generate_series(1, 9);
--
--   select public.book_slot((current_date + 1), '18:00', 2,
--            'มาสาย', '0800000000', null, '203.0.113.11');
--     -- {"status":"slot_full","seats_remaining":0}   <- not an exception
-- rollback;
--
--
-- 6. The distinguishable rejection paths.
--
-- select public.book_slot(current_date - 1, '18:00', 2, 'อดีต', '0812345678', null, '203.0.113.9');
--   -- {"status":"slot_past"}
-- select public.book_slot(current_date + 1, '18:00', 13, 'ใหญ่เกิน', '0812345678', null, '203.0.113.9');
--   -- {"status":"invalid_party_size"}
-- select public.book_slot(current_date + 1, '18:00', 2, '', '0812345678', null, '203.0.113.9');
--   -- {"status":"invalid_name"}
-- select public.book_slot(current_date + 1, '18:00', 2, 'เบอร์ผิด', '123', null, '203.0.113.9');
--   -- {"status":"invalid_phone"}
-- select public.book_slot(current_date + 1, '99:99', 2, 'ช่องผิด', '0812345678', null, '203.0.113.9');
--   -- {"status":"invalid_slot"}
--
-- Closed date:
-- begin;
--   insert into public.closed_dates (closed_date, reason) values (current_date + 1, 'ทดสอบ');
--   select public.book_slot(current_date + 1, '18:00', 2, 'วันหยุด', '0812345678', null, '203.0.113.9');
--     -- {"status":"slot_closed"}
--   select is_closed from public.slot_availability(current_date + 1) limit 1;  -- true
-- rollback;
--
--
-- 7. Rate limits. 10 attempts in an hour from one IP, then the 11th is blocked.
--
-- begin;
--   select public.book_slot(current_date + 1, '19:00', 1, 'ยิงรัว', '0811111111', null, '198.51.100.7')
--     from generate_series(1, 11);
--     -- rows 1-3 ok, row 4 rate_limited_phone (3 bookings/day/phone),
--     -- rows 11+ rate_limited_ip with retry_after_seconds
--   select client_ip, outcome, count(*)
--     from public.booking_attempt
--    where client_ip = '198.51.100.7'
--    group by 1, 2 order by 3 desc;
-- rollback;
--
--
-- 8. Capacity is never oversold under concurrency. This one cannot be checked
--    from a single SQL Editor tab — open two tabs and run this in both at the
--    same time against a slot with 4 seats left; exactly one must succeed.
--
-- select public.book_slot(current_date + 1, '20:00', 4, 'แข่งกัน', '0822222222', null, '198.51.100.8');
--
--
-- 9. Housekeeping.
--
-- select public.prune_booking_attempts();   -- rows deleted (older than 7 days)
-- select count(*) as live_attempts from public.booking_attempt;
-- ============================================================================
