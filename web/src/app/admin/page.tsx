import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { toBangkokDateKey } from '@/lib/restaurant';
import StaffHeader from '@/components/admin/StaffHeader';
import BookingCard, { type BookingRecord } from '@/components/admin/BookingCard';
import { formatBookingDate } from './formatBooking';
import { holdsSeats } from './bookingStatus';
import { signOut } from './actions';

export const metadata: Metadata = {
  title: 'รายการจองโต๊ะ — โรงเตี๊ยมมังกรทอง',
  robots: { index: false, follow: false },
};

// This page renders customers' names and phone numbers. It reads cookies (so it
// is dynamic already), but the intent is stated explicitly rather than left as a
// side effect of how the Supabase client happens to be built: no part of this
// response may ever be cached or prerendered and served to another request.
export const dynamic = 'force-dynamic';

// One screen of bookings. Enough for a full day's service several times over,
// while keeping a compromised or curious session from pulling the entire
// customer table in a single request.
const MAX_ROWS = 200;

// Only the columns the screen actually shows. `id` is deliberately absent: the
// human-facing booking_ref is what staff and customers speak, and it is unique,
// so the internal uuid never needs to reach the browser.
const BOOKING_COLUMNS =
  'booking_ref, booking_date, time_slot, party_size, customer_name, customer_phone, note, status, created_at';

type View = 'upcoming' | 'past';

interface AdminPageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { view: rawView } = await searchParams;
  const view: View = rawView === 'past' ? 'past' : 'upcoming';

  // Rendered with the signed-in staff member's OWN session, so every read below
  // is filtered by RLS (`bookings_staff_select`, `to authenticated`). The
  // BYPASSRLS secret key is deliberately not used anywhere on this page — if the
  // session were somehow absent, the correct outcome is zero rows, not "all
  // rows via an elevated key".
  const supabase = await createClient();

  // getClaims(), not getSession(): the JWT signature is verified here rather
  // than trusting whatever the cookie says. This is the authorization boundary
  // for the page; proxy.ts is only a redirect convenience in front of it.
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    redirect('/login');
  }

  const staffEmail =
    typeof claims.claims.email === 'string' ? claims.claims.email : 'พนักงาน';

  // "Today" in Asia/Bangkok, never the host's date — on a UTC server the
  // evening in Bangkok is already tomorrow, which would drop the current
  // service from an "upcoming" list built from the host clock.
  const today = toBangkokDateKey(new Date());

  // Upcoming is the default view and is sorted soonest-first, because the
  // operational question this page answers is "who is coming in next".
  // The past view is reversed for the mirror-image reason.
  const query = supabase.from('bookings').select(BOOKING_COLUMNS);
  const { data, error } =
    view === 'past'
      ? await query
          .lt('booking_date', today)
          .order('booking_date', { ascending: false })
          .order('time_slot', { ascending: false })
          .limit(MAX_ROWS)
      : await query
          .gte('booking_date', today)
          .order('booking_date', { ascending: true })
          .order('time_slot', { ascending: true })
          .limit(MAX_ROWS);

  const bookings = (data ?? []) as BookingRecord[];
  const groups = groupByDate(bookings);

  return (
    <>
      <StaffHeader
        subtitle="Staff · รายการจองโต๊ะ"
        action={
          <form action={signOut}>
            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-xs text-cream/60">{staffEmail}</span>
              <button
                type="submit"
                className="px-4 py-2 rounded-md text-sm font-bold text-gold-light border-2 border-gold/60 hover:bg-gold/15 transition"
              >
                ออกจากระบบ
              </button>
            </div>
          </form>
        }
      />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-lg md:text-xl font-bold text-deep-red">
            {view === 'past' ? 'รายการจองที่ผ่านมา' : 'รายการจองที่กำลังจะถึง'}
          </h2>

          <nav className="flex gap-2 text-sm" aria-label="ช่วงเวลา">
            <ViewTab href="/admin" label="กำลังจะถึง" active={view === 'upcoming'} />
            <ViewTab href="/admin?view=past" label="ที่ผ่านมา" active={view === 'past'} />
          </nav>
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm text-lucky-red bg-lucky-red/5 border border-lucky-red/30 rounded-md px-4 py-3 mb-6"
          >
            ไม่สามารถโหลดรายการจองได้ กรุณารีเฟรชหน้า
          </p>
        )}

        {!error && groups.length === 0 && (
          <p className="bg-cream double-border rounded-lg p-8 text-center text-sm text-ink/60">
            {view === 'past' ? 'ยังไม่มีรายการจองที่ผ่านมา' : 'ยังไม่มีรายการจองที่กำลังจะถึง'}
          </p>
        )}

        <div className="space-y-8">
          {groups.map(({ dateKey, items }) => {
            const heldSeats = items
              .filter((booking) => holdsSeats(booking.status))
              .reduce((total, booking) => total + booking.party_size, 0);

            return (
              <section key={dateKey}>
                <div className="flex flex-wrap items-baseline gap-3 border-b-2 border-gold/50 pb-2 mb-4">
                  <h3 className="font-bold text-deep-red">{formatBookingDate(dateKey)}</h3>
                  {dateKey === today && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold">
                      วันนี้
                    </span>
                  )}
                  {/* Seats held, not bookings counted: cancelled rows have
                      released their seats, so counting them here would overstate
                      how full the day is. */}
                  <span className="text-xs text-ink/50">
                    {items.length} รายการ · {heldSeats} ที่นั่ง
                  </span>
                </div>

                <ul className="space-y-3">
                  {items.map((booking) => (
                    <BookingCard key={booking.booking_ref} booking={booking} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {bookings.length === MAX_ROWS && (
          <p className="text-xs text-ink/40 text-center mt-8">
            แสดง {MAX_ROWS} รายการแรกเท่านั้น
          </p>
        )}
      </main>
    </>
  );
}

function ViewTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-4 py-2 rounded-md font-bold border-2 transition ${
        active
          ? 'text-cream bg-gradient-to-b from-lucky-red to-deep-red border-deep-red shadow-gold'
          : 'text-deep-red border-gold hover:bg-gold-light/30'
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Groups the already-sorted rows by booking_date, preserving the order the
 * database returned them in — so the grouping never re-sorts and the two views
 * (soonest-first / most-recent-first) both come out right without a second
 * comparator to keep in sync.
 */
function groupByDate(bookings: BookingRecord[]): { dateKey: string; items: BookingRecord[] }[] {
  const groups: { dateKey: string; items: BookingRecord[] }[] = [];

  for (const booking of bookings) {
    const last = groups.at(-1);
    if (last && last.dateKey === booking.booking_date) {
      last.items.push(booking);
    } else {
      groups.push({ dateKey: booking.booking_date, items: [booking] });
    }
  }

  return groups;
}
