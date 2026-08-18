// Real-world restaurant configuration plus the timezone-correct calendar logic
// the booking flow is built on. Replaces the prototype's fake `seededFull` hash
// in booking.ts, which is only still there until the persistence wave lands.

import { DAYS_AHEAD, TIME_SLOTS } from '@/lib/booking';

/**
 * The one timezone this whole system reasons in. This is load-bearing, not
 * cosmetic: the app deploys to Vercel, whose servers run in UTC, so anything
 * that leans on the host's local timezone (`getDate()`, `getHours()`,
 * `toISOString().slice(0, 10)`) silently disagrees with the restaurant's own
 * calendar by 7 hours — enough to put a late-evening Bangkok booking on the
 * wrong day, or to keep offering a lunch slot that has already been served.
 * Every day-of / has-it-passed decision below therefore names the zone
 * explicitly.
 */
export const RESTAURANT_TIME_ZONE = 'Asia/Bangkok';

/**
 * The restaurant's real per-slot seat capacity. A booking consumes seats equal
 * to its party size, so a slot is full once the party sizes booked into it sum
 * to this number. If the dining room is ever re-laid-out, this is the single
 * value to change.
 */
export const SEATS_PER_SLOT = 40;

/**
 * Specific calendar dates ('YYYY-MM-DD', read in Asia/Bangkok) on which the
 * restaurant does not open at all. There is no recurring weekly closure — the
 * kitchen serves every day of the week — so this list is not a day-of-week
 * rule; it is a hand-maintained list of one-off holiday closures (Chinese New
 * Year, staff outings, and so on) that someone adds entries to as they are
 * decided.
 */
export const CLOSED_DATES: readonly string[] = [];

// Asia/Bangkok is a fixed UTC+7 with no DST, but going through Intl rather than
// adding 7 hours by hand keeps this correct if the zone's rules ever change and
// makes the intent obvious at the call site.
function bangkokParts(instant: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RESTAURANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const out: Record<string, string> = {};
  for (const { type, value } of parts) {
    out[type] = value;
  }
  return out;
}

/**
 * Formats an instant as the 'YYYY-MM-DD' calendar date it falls on *in
 * Asia/Bangkok*. This string is the key bookings get grouped by when counting
 * seats per slot, so computing it in the host timezone instead would
 * mis-bucket every booking made late at night — 22:00 Bangkok is still the
 * previous day in UTC, and those rows would be counted against the wrong day's
 * capacity.
 */
export function toBangkokDateKey(instant: Date): string {
  const { year, month, day } = bangkokParts(instant);
  return `${year}-${month}-${day}`;
}

// Bangkok wall-clock time of day as 'HH:mm', in the same shape as TIME_SLOTS so
// the two can be compared directly as strings.
function toBangkokTimeOfDay(instant: Date): string {
  const { hour, minute } = bangkokParts(instant);
  return `${hour}:${minute}`;
}

/**
 * `closedDates` is a parameter rather than a direct read of CLOSED_DATES so
 * tests can exercise a real closure while the shipped list is still empty —
 * otherwise the only assertable behaviour would be "nothing is ever closed",
 * which would keep passing even if the lookup were broken.
 */
export function isClosedDate(date: Date, closedDates: readonly string[] = CLOSED_DATES): boolean {
  return isClosedDateKey(toBangkokDateKey(date), closedDates);
}

// ---------- Calendar-key variants ----------
// The server trust boundary works in 'YYYY-MM-DD' strings, not Date objects: a
// client posting a booking sends the calendar date it picked, and re-hydrating
// that into a Date would mean assuming Bangkok's UTC offset by hand — exactly
// the shortcut the top-of-file comment exists to avoid. So the key-based checks
// below are the primitives, and the Date-based functions above delegate to them.

/** Whether a 'YYYY-MM-DD' key is one of the restaurant's one-off closure dates. */
export function isClosedDateKey(
  dateKey: string,
  closedDates: readonly string[] = CLOSED_DATES
): boolean {
  return closedDates.includes(dateKey);
}

/** Whether `slot` is one of the 12 slots on the menu. */
export function isValidTimeSlot(slot: string): boolean {
  return (TIME_SLOTS as readonly string[]).includes(slot);
}

/** Well-formed 'YYYY-MM-DD' that also names a real calendar day (rejects 2026-02-30). */
export function isValidDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  // Round-tripping through a UTC instant is what catches an out-of-range day:
  // Date.UTC rolls 2026-02-30 forward to 2026-03-02, so the key it formats back
  // to no longer matches the input.
  const [year, month, day] = dateKey.split('-').map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return utcDateKey(instant) === dateKey;
}

// Formats an instant as its UTC calendar date. Only ever applied to instants
// built at UTC midnight by the window arithmetic below, where "the UTC date" and
// "the intended calendar date" are the same thing by construction.
function utcDateKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * The DAYS_AHEAD calendar dates the restaurant currently accepts bookings for,
 * as 'YYYY-MM-DD' keys, starting with today in Bangkok. This is the server-side
 * mirror of what `buildDates()` renders in the picker — the client sends back a
 * date it claims to have been offered, and this is what that claim is checked
 * against.
 *
 * Day arithmetic runs on UTC midnights rather than on a Bangkok-local Date so
 * that "+1 day" is always exactly 24h with no offset to reason about; the
 * Bangkok-ness lives entirely in which day the window STARTS on.
 */
export function bookingWindowDateKeys(now: Date = new Date()): string[] {
  const [year, month, day] = toBangkokDateKey(now).split('-').map(Number);
  const start = Date.UTC(year, month - 1, day);
  const oneDay = 24 * 60 * 60 * 1000;
  return Array.from({ length: DAYS_AHEAD }, (_, i) => utcDateKey(new Date(start + i * oneDay)));
}

/** Whether `dateKey` is a date the restaurant is currently taking bookings for. */
export function isWithinBookingWindow(dateKey: string, now: Date = new Date()): boolean {
  return bookingWindowDateKeys(now).includes(dateKey);
}

/**
 * Key-based twin of `isSlotInPast`. Compares zero-padded 'YYYY-MM-DDTHH:mm'
 * strings, which sort chronologically as plain text, so the whole decision is
 * one string compare with no arithmetic to get wrong.
 */
export function isSlotKeyInPast(dateKey: string, slot: string, now: Date = new Date()): boolean {
  const reference = `${toBangkokDateKey(now)}T${toBangkokTimeOfDay(now)}`;
  return `${dateKey}T${slot}` < reference;
}

/**
 * Whether `slot` on `date` has already started, judged in Bangkok wall-clock
 * terms: any slot earlier today is past, and no slot on a later date ever is.
 * A slot starting exactly this minute counts as still bookable.
 *
 * `now` is a parameter rather than an internal `new Date()` so callers — and
 * especially tests — can pin the reference instant. Without that, a test for
 * "a slot earlier today is past" is only true depending on what time the suite
 * happens to run.
 */
export function isSlotInPast(date: Date, slot: string, now: Date = new Date()): boolean {
  return isSlotKeyInPast(toBangkokDateKey(date), slot, now);
}

/** Seats already booked into one time slot on one date, as the server will report them. */
export interface SlotSeatsTaken {
  slot: string;
  seatsTaken: number;
}

/** Per-slot availability as it will arrive at the UI: the slot, what's left, and whether it can be picked. */
export interface SlotAvailability {
  slot: string;
  seatsRemaining: number;
  selectable: boolean;
}

/** The two injectable seams of the availability calculation — see the comments on each. */
export interface AvailabilityContext {
  now?: Date;
  closedDates?: readonly string[];
}

/**
 * The single home for all "can this slot be picked" reasoning, so the UI never
 * re-derives any part of it. Driven by TIME_SLOTS rather than by `seatsTaken`,
 * so a slot nobody has booked yet still appears (as fully available) and the
 * slot order is always the menu's order.
 *
 * Note that `partySize` is part of the decision, not just emptiness: a slot
 * with 3 seats left is unselectable for a party of 6.
 */
export function buildSlotAvailability(
  seatsTaken: readonly SlotSeatsTaken[],
  date: Date,
  partySize: number,
  { now = new Date(), closedDates = CLOSED_DATES }: AvailabilityContext = {}
): SlotAvailability[] {
  const closed = isClosedDate(date, closedDates);
  const takenBySlot = new Map(seatsTaken.map((entry) => [entry.slot, entry.seatsTaken]));

  return TIME_SLOTS.map((slot) => {
    const seatsRemaining = Math.max(0, SEATS_PER_SLOT - (takenBySlot.get(slot) ?? 0));
    return {
      slot,
      seatsRemaining,
      selectable: !closed && !isSlotInPast(date, slot, now) && seatsRemaining >= partySize,
    };
  });
}
