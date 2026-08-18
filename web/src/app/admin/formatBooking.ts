import { formatDate } from '@/lib/booking';
import { RESTAURANT_TIME_ZONE, toBangkokDateKey } from '@/lib/restaurant';

/**
 * Turns a Postgres `date` ('YYYY-MM-DD') into a Date that formatDate can read.
 *
 * The component parts are passed to the Date constructor rather than letting it
 * parse the string, because `new Date('2026-08-18')` is defined to parse as
 * midnight *UTC*, while formatDate reads the value back with local getters
 * (getDate/getMonth/getDay). On a UTC+7 host that combination is harmless, but
 * on a host behind UTC — or anywhere west of Greenwich — it renders the previous
 * day. Building it as local midnight makes the calendar date survive the round
 * trip on any host, which matters because Vercel runs in UTC.
 */
export function parseBookingDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The Thai Buddhist-era date string, formatted by the very same formatDate the
 * customer-facing wizard uses, so a staff member reading a booking back to a
 * customer on the phone says exactly what the customer saw.
 */
export function formatBookingDate(dateKey: string): string {
  return formatDate(parseBookingDate(dateKey));
}

// Bangkok wall clock, because a timestamptz rendered in the host's zone would
// tell staff a booking was taken at a time nobody in the restaurant recognises.
const BANGKOK_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: RESTAURANT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Renders a `timestamptz` as 'วัน… ที่ D MON BBBB HH:mm น.' in Bangkok time. */
export function formatCreatedAt(isoTimestamp: string): string {
  const instant = new Date(isoTimestamp);
  const dateKey = toBangkokDateKey(instant);
  return `${formatBookingDate(dateKey)} ${BANGKOK_TIME_FORMAT.format(instant)} น.`;
}
