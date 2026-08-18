# Supabase + Next.js 16 (App Router) on Vercel — research notes

Research date: **2026-08-18**. Target stack: Next.js 16 App Router, React 19, Vercel, Supabase Postgres.

> ## Research was cut short — read this first
>
> Four of the planned doc fetches were **declined by the user mid-session** (the Supavisor
> FAQ, `supabase.com/docs/guides/database/functions`, the RLS guide, and a domain-scoped
> web search). Everything that depended on those pages is marked **UNVERIFIED** below and
> has deliberately **not** been filled in from memory, per the research brief.
>
> Fully verified: Q1 (partly), Q3 connection strings/ports, Q4 Postgres semantics, Q5 key model.
> Not verified at all: **Q6 (Auth), Q7 (migrations), Q8 (free tier / idle pause / pg_cron)**.
> Q2 and Q3's limitation list are partly verified.

## Bottom line (for a tech lead)

- **Package is `@supabase/ssr`** plus `@supabase/supabase-js`. Verified. But two things changed
  from what I expected: the docs now say **`supabase.auth.getClaims()`**, *not* `getUser()`, and
  explicitly *"Never trust `supabase.auth.getSession()`"* in server code; and the documented env
  var is **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**, not `..._ANON_KEY`.
- **Push the capacity check into a `plpgsql` function called via `.rpc()`.** A PL/pgSQL *function*
  cannot `COMMIT`/`ROLLBACK` (verified in Postgres docs) — which is exactly what we want: the whole
  body is one atomic unit, so a `pg_advisory_xact_lock` taken inside it is released when it ends.
- **`pg_advisory_xact_lock` on hash(date, slot) + aggregate + conditional insert is the right
  primitive.** Postgres docs confirm transaction-level advisory locks *"are automatically released
  at the end of the transaction"*. SERIALIZABLE also works but forces a `40001` retry loop
  everywhere; `SELECT ... FOR UPDATE` works only if you add an anchor row per slot.
- **READ COMMITTED alone is unsafe here** — verified: *"This behavior makes Read Committed mode
  unsuitable for commands that involve complex search conditions."* An `INSERT` guarded by a
  `SUM()` read is precisely that. This is the technical reason overselling is possible without a lock.
- **From Vercel, use the transaction-mode pooler on port 6543** (`aws-<region>.pooler.supabase.com`)
  if you use `pg` at all — Supabase's own docs call transaction mode *"ideal for serverless or edge
  functions"*. But the `.rpc()` HTTP path sidesteps pooling entirely, so prefer it.
- **`service_role` / `sb_secret_*` keys bypass RLS via Postgres `BYPASSRLS`** (verified). Server-only,
  never in a `NEXT_PUBLIC_*` var. **Idle-pause behaviour on the free tier is UNVERIFIED** and must be
  confirmed before this runs a real restaurant.

---

## 1. How should Next.js App Router server code talk to Supabase today?

**Confidence: high on the package name and the security guidance; medium on the exact snippet
shapes** (the docs render some snippets as copy-blocks that did not come through the fetch intact,
so treat the code below as *shape*, and re-copy from the doc page before shipping).

### Current package

```bash
npm install @supabase/supabase-js @supabase/ssr
```

`@supabase/ssr` is the current documented package. **Notable:** the current Next.js server-side page
does **not** mention `@supabase/auth-helpers-nextjs` at all — not even as deprecated. It has been
dropped from the docs rather than flagged. So "is `auth-helpers-nextjs` deprecated?" is best answered
as: *it is no longer the documented path*; I could not find a current page that formally deprecates it.

### Environment variables (as documented, in `.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=supabase_publishable_key
```

This **contradicted my expectation** of `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See Q5 — Supabase has moved
to `sb_publishable_*` / `sb_secret_*` keys and the docs' variable naming followed.

### (a) + (c) Server client — used by both Server Actions and Server Components

`lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const createClient = async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => cookieStore.set(name, value));
        },
      },
    }
  );
};
```

Note `await cookies()` — Next.js 15+ made `cookies()` async, and the current Supabase snippet reflects
that. The `getAll`/`setAll` cookie interface is the current one (the older `get`/`set`/`remove` triple
is gone).

There is **one** server client factory; a Server Action that writes and a Server Component that reads
the logged-in user both call it. The difference is only what you do next.

**Reading the logged-in user in a server component — the changed part:**

```ts
const supabase = await createClient();
const { data, error } = await supabase.auth.getClaims();
```

The docs state, emphatically: *"Always use `supabase.auth.getClaims()` to protect pages and user data.
Never trust `supabase.auth.getSession()`"* in server code. The stated reason is that `getClaims()`
validates the JWT signature against Supabase's published public keys on every call, whereas
`getSession()` has no revalidation guarantee. **This contradicted my expectation**, which was that
`getUser()` was the blessed call — `getClaims()` is asymmetric-JWT-era guidance and is newer.

⚠️ I did not verify the exact shape of `data` returned by `getClaims()` (claim names, where the user id
lives). **UNVERIFIED** — check the auth API reference before writing an authorization check against it.

### (b) Route Handler that reads

**Confidence: low on exact code.** The fetched page produced a snippet built around
`parseCookieHeader(request.headers.get('Cookie'))` with a `getAll`-only cookie adapter (read-only is
fine for a handler that never refreshes a session), but I could not confirm it verbatim, and
`parseCookieHeader`'s current signature is **UNVERIFIED**. For a *read-only* handler the safest
current-documented move is to reuse the `cookies()`-based server client above, since Route Handlers
can call `cookies()`.

### Middleware — now a "Proxy" layer

The current docs describe this as a **Proxy** layer whose job is to refresh tokens by calling
`supabase.auth.getClaims()`, copy cookies onto both `request.cookies` and `response.cookies`, and set
`Cache-Control` / `Expires` / `Pragma` headers *"to prevent CDN leakage"* of authenticated pages.

The "Proxy" naming is significant: **Next.js 16 renamed `middleware.ts` to `proxy.ts`**. I did
**not** verify that rename against `nextjs.org/docs` in this session — **UNVERIFIED**, and it is the
single highest-value thing to confirm first, because it decides the filename you create.

---

## 2. `.rpc()` vs a direct `pg` connection for the capacity write

**Recommendation: `plpgsql` function invoked via `.rpc()`.** Confidence: high on the reasoning,
medium on doc citation, because the `guides/database/functions` fetch was declined.

### Can supabase-js run a multi-statement transaction?

**No — and this is the crux.** supabase-js speaks to **PostgREST over HTTP**. Each HTTP request is a
single round trip; there is no client API to open a transaction, issue several statements, and commit.
You therefore cannot express "take a lock → aggregate → conditionally insert" as a sequence of
`supabase.from(...)` calls, because each one is a separate, independently-committed transaction, and
another request can interleave between them. That is exactly the oversell window.

⚠️ **UNVERIFIED as a doc citation.** The Supabase page that states this outright is
`supabase.com/docs/guides/database/functions` (and the PostgREST transaction docs), and that fetch was
declined. I am stating it as an architectural consequence of PostgREST's request model, not as a quote.
Verify before treating it as settled.

The corollary is the standard one: **any multi-step atomic logic must be pushed down into a database
function and called with one `.rpc()`**, so the whole thing is one statement to Postgres and therefore
one transaction.

### Does a `plpgsql` function body run in a single implicit transaction?

**Yes — verified, by the restriction rather than by a positive statement.** PostgreSQL's PL/pgSQL
transaction-management docs say transaction control is available only in *"procedures invoked by the
`CALL` command as well as in anonymous code blocks (`DO` command)"*, where *"it is possible to end
transactions using the commands `COMMIT` and `ROLLBACK`."* Functions are excluded from that list, and
PL/pgSQL does **not support savepoints** *"as they would conflict with explicit transaction control in
procedures."*

A function that cannot begin, commit, or roll back a transaction can only ever run inside one
established by its caller. **Therefore `pg_advisory_xact_lock()` taken inside a `plpgsql` function is
released when the function's enclosing statement/transaction ends** — which for a single `.rpc()` call
is the end of that call. That is precisely the lifetime we want: no leaked locks, no cleanup code.

Caveat on citation quality: I looked for the well-known sentence *"functions and trigger procedures
always execute within a transaction established by an outer query"* on
`postgresql.org/docs/current/plpgsql-transactions.html` and **it was not present on that page**. The
conclusion above rests on the verified `COMMIT`/`ROLLBACK` restriction plus the savepoint note, which
is sound but is an inference. If you want the direct sentence, look at the function-volatility or
trigger chapters — **UNVERIFIED** which page carries it now.

### When would you still want `pg`?

Only if you need genuine client-side multi-statement transactions spanning several round trips, or
`LISTEN`/`NOTIFY`, or `COPY`. This app needs none of those. Adding `pg` buys you a connection-pool
problem (Q3) in exchange for nothing.

### Sketch (my code, not from docs — review before use)

```sql
create or replace function book_slot(
  p_name text,
  p_phone text,
  p_party_size int,
  p_note text,
  p_date date,
  p_slot text
) returns table (booking_id bigint, seats_left int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_capacity constant int := 40;
  v_taken int;
begin
  if p_party_size < 1 or p_party_size > 12 then
    raise exception 'invalid party size';
  end if;

  -- Serialize all writers for this (date, slot) only. Transaction-scoped, so it is
  -- released when this function's calling statement ends.
  perform pg_advisory_xact_lock(hashtextextended(p_date::text || '|' || p_slot, 0));

  select coalesce(sum(b.party_size), 0) into v_taken
  from public.bookings b
  where b.booking_date = p_date
    and b.time_slot = p_slot
    and b.status <> 'cancelled';

  if v_taken + p_party_size > v_capacity then
    raise exception 'slot full' using errcode = 'P0001';
  end if;

  insert into public.bookings (name, phone, party_size, note, booking_date, time_slot, status)
  values (p_name, p_phone, p_party_size, p_note, p_date, p_slot, 'pending')
  returning id into booking_id;

  seats_left := v_capacity - (v_taken + p_party_size);
  return next;
end;
$$;
```

Called as `await supabase.rpc('book_slot', { ... })` from a Server Action. Two design points worth
arguing about before you ship: the capacity `40` is hardcoded (better as a `slot_capacity` table), and
`status <> 'cancelled'` means a cancellation immediately frees seats — confirm that is the business
rule. Also note `security invoker` here, deliberately — see Q5.

---

## 3. Connection pooling on Supabase from Vercel

**Confidence: high on the connection-string forms and ports; the transaction-mode limitation list is
INCOMPLETE — see the warning.**

### The three documented forms

| Mode | Host / string | Port | IP |
|---|---|---|---|
| Direct connection | `postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres` | **5432** | IPv6 by default; IPv4 requires an add-on |
| Supavisor **session** mode (Shared Pooler) | `postgres://postgres.<ref>:[PASSWORD]@aws-<region>.pooler.supabase.com:5432/postgres` | **5432** | IPv4 on all tiers |
| Supavisor **transaction** mode (Shared Pooler) | `postgres://postgres.<ref>:[PASSWORD]@aws-<region>.pooler.supabase.com:6543/postgres` | **6543** | IPv4 on all tiers |

Note the username differs: direct connections use `postgres`, pooled connections use
`postgres.<project-ref>` (the tenant is encoded in the username, which is how Supavisor routes).

### What Supavisor is, and what Supabase recommends from serverless

Supavisor is Supabase's connection pooler sitting in front of Postgres — it is what the "Shared
Pooler" strings above point at. For our case the docs are unambiguous: **transaction mode is *"ideal
for serverless or edge functions, which require many transient connections."*** That is the mode to
use from Vercel functions.

The reason matters: a Vercel function instance is short-lived and there can be many of them, so each
would otherwise hold a real Postgres backend. Transaction mode returns the server connection to the
pool at the end of **each transaction**, so N concurrent functions do not mean N Postgres backends.

### Does transaction mode break `pg_advisory_xact_lock`?

**No — and this is the good news for our design.** But I must be careful about what is verified.

**Verified from Supabase docs:** transaction mode *"does not support prepared statements"*, and you
should disable them to *"avoid errors."* For `node-postgres` that means don't use named/prepared
statements; for Prisma it means the `pgbouncer=true` / `statement_cache_size=0` style flag.

⚠️ **The full enumerated list of transaction-mode limitations is UNVERIFIED.** The brief asked me to
enumerate it exactly; the page that carries the full list (the Supavisor FAQ) **was declined mid-fetch**,
and my follow-up domain-scoped search was declined too. The **only** limitation I can state on Supabase's
authority is *prepared statements*. I am explicitly **not** listing the others from memory. The
canonical items to go confirm are: session-level advisory locks, `LISTEN`/`NOTIFY`, `SET` / session
variables, temporary tables, and cursors held across transactions.

**The reasoning that saves our design, stated as inference not citation:** the pooling unit in
transaction mode is the transaction. `pg_advisory_xact_lock` is *transaction*-scoped — Postgres docs
verify transaction-level advisory locks *"are automatically released at the end of the transaction, and
there is no explicit unlock operation."* So the lock's entire lifetime is contained inside the unit the
pooler refuses to split. It cannot leak onto a connection that gets handed to another client, because
it is gone before the connection is returned.

The thing that **would** break is **`pg_advisory_lock`** (session-scoped). Postgres docs are explicit
that session-level advisory locks *"do not honor transaction semantics: a lock acquired during a
transaction that is later rolled back will still be held following the rollback."* Through a transaction
pooler, that lock stays on a shared backend connection after your transaction ends — it can be handed to
an unrelated client while still held, and you have no reliable way to release it. **Never use
`pg_advisory_lock` behind a transaction pooler.** Our design uses the `_xact_` variant, so we are fine.

### Does `.rpc()` sidestep pooling entirely?

**Yes — inference, high confidence, but not a doc quote.** `.rpc()` goes over HTTPS to PostgREST, which
Supabase operates and which maintains its own connection pool to Postgres inside the platform. Your
Vercel function holds an HTTP connection, not a Postgres connection, so there is no client-side pool to
size, no port choice, no prepared-statement caveat, and no pooler-mode question at all.

**This is the strongest practical argument for the `.rpc()` path over `pg`:** it removes Q3 from your
list of concerns rather than answering it.

---

## 4. Is `pg_advisory_xact_lock` the right primitive?

**Confidence: high.** This is the best-verified question in the set — both Postgres pages fetched cleanly.

### Why READ COMMITTED and REPEATABLE READ are insufficient on their own

**READ COMMITTED — verified quote:**

> "Because of the above rules, it is possible for an updating command to see an inconsistent snapshot:
> it can see the effects of concurrent updating commands on the same rows it is trying to update, but it
> does not see effects of those commands on other rows in the database. This behavior makes Read
> Committed mode unsuitable for commands that involve complex search conditions."

And on why the simple money-transfer case is *not* a counterexample: it works only because *"each
command is affecting only a predetermined row."* Our insert is guarded by a `SUM()` over a *set* of rows
that another transaction may be adding to — the opposite of a predetermined row. Each statement in READ
COMMITTED takes a **fresh snapshot**, so two concurrent bookings can both read `taken = 36`, both
conclude a party of 4 fits, and both insert. Total 44 against a 40-seat pool. Nothing in READ COMMITTED
prevents this, because neither transaction ever touches a row the other locked.

**REPEATABLE READ — verified:** Postgres's implementation *"does not allow phantom reads"*, and a RR
transaction sees *"a snapshot as of the start of the first non-transaction-control statement in the
transaction."* But that snapshot stability is the trap: it guarantees your `SUM()` doesn't *change*
under you, it does **not** guarantee it was correct at commit time. RR only raises
`could not serialize access due to concurrent update` on **write-write** conflicts on the same row.
Two `INSERT`s of *different new rows* conflict on nothing. Both commit. You have oversold, with a
perfectly stable snapshot in each transaction. **RR is arguably more dangerous than READ COMMITTED here
because it feels safer.**

### The three candidates

**(a) `pg_advisory_xact_lock(hash(date, slot))` then aggregate-then-insert at READ COMMITTED — CORRECT.**
Verified: transaction-level advisory locks *"are automatically released at the end of the transaction,
and there is no explicit unlock operation,"* which the docs call *"often more convenient than the
session-level behavior for short-term usage."* The docs also endorse this class of use — advisory locks
suit *"locking strategies that are an awkward fit for the MVCC model,"* e.g. *"to emulate pessimistic
locking strategies."* An aggregate-guarded insert is exactly such an awkward fit: there is no existing
row to lock, so MVCC has nothing to protect.

Cost: low. One extra line. No retry loop, no error taxonomy in the app, no schema change. Contention is
per-`(date, slot)`, so bookings for different slots never block each other. Correctness does depend on
**every** writer taking the lock — an `INSERT` that skips it is invisible to the mechanism. Put the
insert *only* inside the function and never grant direct table `INSERT` to `anon` (Q5).

Also verified as a bonus: advisory locks *"are faster, avoid table bloat, and are automatically cleaned
up by the server at the end of the session"* compared with a flag column in a table.

**(b) SERIALIZABLE + retry loop — CORRECT, but costlier.** SSI would detect our read/write dependency
and abort one transaction with `40001`. Verified requirement, though:

> "It is important that an environment which uses this technique have a generalized way of handling
> serialization failures (which always return with an SQLSTATE value of '40001'), because it will be
> very hard to predict exactly which transactions might contribute to the read/write dependencies and
> need to be rolled back."

And: *"any data read from a permanent user table not be considered valid until the transaction which
read it has successfully committed. This is true even for read-only transactions."*

Cost: you must build the retry loop, and — the awkward part — **you cannot retry inside the `plpgsql`
function**, because a function cannot `COMMIT`/`ROLLBACK` (Q2). The retry has to live in TypeScript,
wrapping the `.rpc()` call, with a bounded attempt count and backoff, and it must be careful not to
double-insert. That is materially more code and more ways to be subtly wrong than option (a).
Reasonable if you were already SERIALIZABLE across the app. We are not.

**(c) `SELECT ... FOR UPDATE` on an anchor row — CORRECT *only if* you create the anchor.** `FOR UPDATE`
locks rows the query returns; our problem is rows that don't exist yet, so locking the `bookings` rows
you aggregated protects nothing against a new insert. It becomes correct if you add a `slots` table with
one row per `(date, slot)` and lock that row first — which is a real, defensible design (the anchor row
is also the natural home for per-slot `capacity`, replacing my hardcoded `40`).

Cost: medium. New table, plus a guarantee that an anchor row **always exists** before any booking
(seed job or an upsert-then-lock dance). Its failure mode is worse than (a)'s: a missing anchor row
means `FOR UPDATE` locks *zero* rows and silently provides **no** mutual exclusion. Silent correctness
loss beats loud failure only in the wrong direction.

### Recommendation

**Go with (a): `pg_advisory_xact_lock` inside a `plpgsql` function called via one `.rpc()`.** It is
correct, it is the least code, it needs no schema change, it works through the transaction-mode pooler
(Q3), and its lock lifetime is guaranteed by the same restriction that makes the function atomic (Q2).

Take (c) instead **if** you were going to build a `slots`/`slot_capacity` table anyway for per-slot
capacity — then the anchor row is free and the lock is a side benefit. Take (b) only if something else
forces SERIALIZABLE on you.

The same advisory-lock-in-a-function pattern covers the **per-IP / per-phone rate limit** counters: same
read-then-write shape, same fix, no Redis.

---

## 5. Row Level Security

**Confidence: high on the key model (fetched cleanly). MEDIUM-LOW on policy syntax and the
`SECURITY DEFINER` interaction — the RLS guide fetch was declined.**

### Keys — verified

| Key | Current name | Legacy name | Privileges |
|---|---|---|---|
| Public | `sb_publishable_...` | `anon` (JWT) | Low; **safe to expose publicly** |
| Secret | `sb_secret_...` | `service_role` (JWT) | Full access; **bypasses RLS** |

Verified statements:

- Secret keys *"provide full access to your project's data, bypassing Row Level Security"* and use the
  Postgres **`BYPASSRLS`** role attribute, *"skipping any and all Row Level Security policies."*
  So: **yes, `service_role` bypasses RLS**, and it does so at the Postgres role level — not via
  application logic you could patch around.
- Publishable keys are appropriate for *"web pages, mobile/desktop apps, CLIs, public APIs."*
- Secret keys are for *"backend servers, Edge Functions, microservices, admin tools"*;
  *"Never expose your secret keys publicly."* Notably, they **cannot be used from a browser at all** —
  Supabase returns **HTTP 401 Unauthorized** if you try. A useful backstop, but do not rely on it.
- **Legacy JWT-based `anon` / `service_role` keys "will be deprecated by the end of 2026."** Existing
  keys keep working until explicitly disabled. Since this is a new project in Aug 2026, **start on
  `sb_publishable_*` / `sb_secret_*`** — adopting the legacy names now would buy a migration inside months.

### The exact mistake that would leak customer data

**Putting the secret key in a `NEXT_PUBLIC_*` environment variable.** In Next.js, any env var prefixed
`NEXT_PUBLIC_` is **inlined into the client bundle at build time** and is readable by anyone who opens
devtools. Because the secret key carries `BYPASSRLS`, leaking it hands the public a key that reads
**every booking row — every customer name and phone number — regardless of any policy you wrote.** RLS
becomes decorative. This is the one mistake to grep for before every deploy:

```
NEXT_PUBLIC_SUPABASE_SECRET_KEY=...    # catastrophic — never
SUPABASE_SECRET_KEY=...                # correct: server-only, unprefixed
```

Two adjacent traps worth naming:

1. **A table with RLS not enabled is fully readable with the publishable key.** RLS is opt-in per table;
   the publishable key is *designed* to be public, so its safety depends **entirely** on policies
   existing. A booking table with RLS off is a public dump of names and phone numbers.
2. **Any Server Component or Server Action that uses the secret key must not return raw rows to the
   client.** Server Component props are serialized to the browser. Bypassing RLS server-side then
   passing the result into a Client Component re-exposes it.

### Expressing "anon may INSERT, may never SELECT" — reasoning, NOT verified syntax

⚠️ The policy-syntax details below are **UNVERIFIED** (fetch declined). The shape follows from the
Postgres RLS model, but **confirm against `supabase.com/docs/guides/database/postgres/row-level-security`
before shipping.** In particular I did not verify whether the Supabase dashboard enables RLS by default
on newly created tables — do not assume it does; check each table explicitly.

The soundest design given what *is* verified sidesteps policy subtlety almost entirely:

- Enable RLS on `bookings` and grant `anon` **no** table-level policies at all — no SELECT, no INSERT.
- Expose writes **only** through `book_slot()` (Q2). The public form calls `.rpc('book_slot', ...)`
  and can do nothing else. It returns only a booking id and seats-left — never another customer's row.
- Staff reads go through the authenticated staff user with a SELECT policy, or through a server-only
  admin path using the secret key (which bypasses RLS by design, and is acceptable *because* it never
  reaches the browser).

This means the anon client has **no direct table access whatsoever**, so there is no SELECT policy to
get subtly wrong. That is a much stronger position than "INSERT allowed, SELECT denied by policy."

### `SECURITY DEFINER` and RLS — UNVERIFIED, and the sharp edge

A `SECURITY DEFINER` function runs with the **privileges of its owner** rather than the caller. If owned
by a superuser-ish/`BYPASSRLS` role, its body can therefore **bypass RLS on the tables it touches** —
which makes it a deliberate, auditable hole in your policy wall, and a dangerous one if the function
takes caller-controlled input that reaches a query.

⚠️ **I could not verify Supabase's current wording** on `SECURITY DEFINER` vs `SECURITY INVOKER`
(which is the Postgres default), nor their `set search_path = ''` recommendation's exact rationale, nor
their guidance on which to prefer. Both fetches that would have covered it were declined.

Practical consequence for our design: I wrote `book_slot()` as **`security invoker`** in Q2, so it runs
as the caller and RLS still applies to it. That is the conservative choice, but it only works if `anon`
has the underlying `INSERT` privilege — which contradicts the "no direct table access" design above.
**This is a genuine unresolved tension** and it is the first thing to settle once the RLS docs are
readable: either
(i) `security invoker` + a narrow `anon` INSERT policy with `WITH CHECK`, or
(ii) `security definer` + `set search_path = ''` + no `anon` table privileges at all.
Option (ii) is the more common Supabase pattern and matches the stronger design, but **do not implement
it from my memory of the docs** — verify the ownership and `search_path` requirements first, because
`SECURITY DEFINER` done carelessly is a privilege-escalation bug.

---

## 6. Supabase Auth for a small staff-only admin

## ⚠️ ENTIRELY UNVERIFIED — do not use

Every fetch that would have answered this was declined before it ran. Per the brief I am **not**
answering from memory. Nothing below is a finding; it is only a list of what to go read.

Open questions, all **UNVERIFIED**:

- **(a) Disabling public sign-ups.** Believed to be a project-level auth setting, but I have not
  confirmed its current name, location, or whether it also affects OAuth providers and invites.
- **(b) Creating users by hand.** Believed possible from the dashboard and from an admin API
  (`auth.admin.createUser`, requiring the secret key), but the current method name, whether email
  confirmation is auto-skipped, and the CLI equivalent are all unconfirmed.
- **(c) Protecting a route in App Router: middleware, layout check, or both?** This is the question I
  most want answered and least want to guess at. The verified Q1 material shows the docs *do* describe a
  proxy/middleware layer, but its stated job there is **token refresh**, which is **not** the same as
  authorization. Whether current guidance treats middleware as sufficient for protection, or insists on
  a per-page/per-layout check as the real gate, is **UNVERIFIED**.

One thing that *is* verified and bears on (c): the docs say to use **`getClaims()`** and *"Never trust
`getSession()`"* in server code. So whatever the shape of the guard, the check inside it should be
`getClaims()`-based.

Read next: `supabase.com/docs/guides/auth/server-side/nextjs` (the protection section specifically),
`supabase.com/docs/guides/auth/auth-admin`, and the Next.js 16 authorization docs on `nextjs.org`.

---

## 7. Migrations

## ⚠️ ENTIRELY UNVERIFIED — do not use

No migrations documentation was fetched; the session was cut short first. I am not answering from memory.

Open questions, all **UNVERIFIED**: whether Supabase CLI migrations committed to the repo are the
current documented approach; the current command names for creating, applying, and diffing migrations;
whether there is a documented GitHub Actions path; whether Supabase has a first-party Vercel integration
that applies migrations; and — the one I specifically wanted and do not have — **whether the docs warn
against running migrations in a Vercel build step.**

On that last point I will note the *reason* the question matters, without claiming a source: a Vercel
build can run concurrently across preview deployments and can be retried, so a build-step migration is
neither serialized nor guaranteed-once, and a failed half-applied migration is coupled to a frontend
build. That is an argument, not a citation.

Read next: `supabase.com/docs/guides/deployment/database-migrations` and
`supabase.com/docs/guides/deployment/managing-environments`.

---

## 8. Free-tier limits and gotchas

## ⚠️ ENTIRELY UNVERIFIED — including the idle-pause fact

Neither `supabase.com/pricing` nor the platform limits pages were fetched. The brief flagged idle-pause
as *"the single most important operational fact for a real restaurant booking system"* — and it is
precisely the fact I do **not** have. I am not going to approximate it.

**UNVERIFIED, must be confirmed before this takes real bookings:**

- **Does the free-tier project pause when idle, after how long, and what does restoring take?**
  Unconfirmed on all three counts. My expectation going in was roughly "pauses after about a week of
  inactivity, restore is a manual dashboard action taking minutes" — but that is memory, the brief
  warned this behaviour has changed more than once, and a restaurant booking form that returns errors
  until someone clicks a dashboard button is a business-critical failure. **Confirm the current
  threshold, whether restore is automatic or manual, and how long it takes.** If pausing is real, a
  paid tier or a keep-alive strategy is not optional for production.
- **Database size cap** on free tier — unconfirmed. (A booking table is tiny; unlikely to bind.)
- **Connection limits** — unconfirmed for both direct and pooled paths. Note this pressure is largely
  moot if you take the `.rpc()` recommendation (Q3), since you hold no Postgres connections.
- **Egress allowance and overage behaviour** — unconfirmed.
- **`pg_cron` availability on the free tier** (for expiring old rows later) — unconfirmed. Also worth
  checking whether a *paused* project's cron jobs run at all, which interacts with the pause question
  above.

Read next: `supabase.com/pricing`, `supabase.com/docs/guides/platform/billing-on-supabase`,
`supabase.com/docs/guides/platform/compute-and-disk`,
`supabase.com/docs/guides/database/extensions/pg_cron`.

---

## Sources actually fetched

Only these four pages were successfully retrieved. Everything in this document that is not marked
UNVERIFIED traces to one of them.

1. `https://supabase.com/docs/guides/auth/server-side/nextjs` — `@supabase/ssr`, env var names,
   `getClaims()` guidance, Proxy layer, CDN cache headers.
2. `https://supabase.com/docs/guides/auth/server-side/creating-a-client` — server client snippet shape,
   `getAll`/`setAll` cookie interface, `await cookies()`, "never trust `getSession()`".
3. `https://supabase.com/docs/guides/database/connecting-to-postgres` — direct / session / transaction
   connection strings, ports 5432 and 6543, serverless recommendation, prepared-statement limitation,
   IPv4/IPv6 notes.
4. `https://supabase.com/docs/guides/api/api-keys` — publishable vs secret keys, `BYPASSRLS`, safe
   usage locations, browser 401, end-of-2026 legacy deprecation.
5. `https://www.postgresql.org/docs/current/explicit-locking.html` — session vs transaction advisory
   locks, release semantics, MVCC-awkward-fit rationale.
6. `https://www.postgresql.org/docs/current/transaction-iso.html` — READ COMMITTED unsuitability,
   REPEATABLE READ snapshot/phantom behaviour, SERIALIZABLE `40001` retry requirement.
7. `https://www.postgresql.org/docs/current/plpgsql-transactions.html` — functions cannot
   `COMMIT`/`ROLLBACK`; no savepoints. (Fetched twice; the second, targeted attempt confirmed the
   "transaction established by an outer query" sentence is **not** on this page.)

### Fetches declined or failed

- `https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI` — **declined by user.**
  Cost: the exact transaction-mode limitation list (Q3).
- `https://supabase.com/docs/guides/database/functions` — **declined by user.** Cost: doc citation for
  "no transactions over PostgREST", and `SECURITY DEFINER` guidance (Q2, Q5).
- `https://supabase.com/docs/guides/database/postgres/row-level-security` — **declined by user.**
  Cost: policy syntax, RLS-by-default behaviour, `SECURITY DEFINER` interaction (Q5).
- Domain-scoped web search for the transaction-mode limitations — **declined by user.**
- Q6, Q7, Q8 pages — never attempted; the session ended first.
