// Pure, DOM-free booking logic ported from the original index.html prototype.
// No React, no browser globals — safe to import from both client and server code.

import {
  isClosedDate,
  isSlotInPast,
  toBangkokDateKey,
  type SlotAvailability,
  type SlotSeatsTaken,
} from '@/lib/restaurant';

// That import makes booking.ts <-> restaurant.ts a cycle (restaurant.ts reads
// TIME_SLOTS from here). It is safe because neither module touches the other
// during module evaluation — every cross-module reference sits inside a function
// body — but it is the reason nothing here may be *initialised* from a
// restaurant.ts value at the top level.

export const THAI_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

export const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

export const TIME_SLOTS = [
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
] as const;

export const DAYS_AHEAD = 10;

const THAI_FULL_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const;

// ---------- Bangkok calendar dates ----------

export interface BangkokCalendarDate {
  year: number;
  /** 1-12, matching the 'YYYY-MM-DD' key rather than Date's 0-11 month index. */
  month: number;
  day: number;
  /** 0 = Sunday, so it indexes THAI_DAYS / THAI_FULL_DAYS directly. */
  weekday: number;
}

/**
 * Splits an instant into the calendar fields Asia/Bangkok would show for it.
 * Every date label in the UI goes through here instead of `getDay()` /
 * `getDate()` / `getMonth()`: those read the *host* timezone, so on Vercel (UTC)
 * a customer browsing between 00:00 and 07:00 Bangkok would be shown the
 * previous day's number and weekday name for every date in the picker.
 */
export function bangkokCalendarDate(instant: Date): BangkokCalendarDate {
  const [year, month, day] = toBangkokDateKey(instant).split('-').map(Number);
  // Day-of-week is derived from the Bangkok Y/M/D triple through a UTC-midnight
  // instant, which is pure calendar arithmetic — no timezone can shift it again.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

/**
 * The next DAYS_AHEAD Bangkok calendar dates, starting with the date it is *in
 * Bangkok* at `now`. Each entry is anchored at 12:00 Bangkok (05:00 UTC) rather
 * than at midnight so the instant sits half a day clear of either date
 * boundary: whichever timezone later reads it back, it still resolves to this
 * calendar date.
 *
 * `now` is a parameter so tests can pin the reference instant. The app leaves it
 * defaulted and must still only call this from inside a client-side useMemo,
 * never at module load time, or the window can differ between the server and
 * client renders.
 */
export function buildDates(now: Date = new Date()): Date[] {
  const { year, month, day } = bangkokCalendarDate(now);
  // Date.UTC rolls a day overflow into the next month (and year) for us, so
  // there is no month-length arithmetic here to get wrong.
  return Array.from(
    { length: DAYS_AHEAD },
    (_, i) => new Date(Date.UTC(year, month - 1, day + i, 5, 0, 0))
  );
}

export function formatDate(d: Date): string {
  const { year, month, day, weekday } = bangkokCalendarDate(d);
  return `วัน${THAI_FULL_DAYS[weekday]}ที่ ${day} ${THAI_MONTHS[month - 1]} ${year + 543}`;
}

// ---------- Slot presentation ----------

export type SlotUnavailableReason = 'closed' | 'past' | 'full' | 'party-too-large';

export interface SlotView extends SlotAvailability {
  unavailableReason: SlotUnavailableReason | null;
}

function reasonFor(
  row: SlotAvailability,
  date: Date,
  now: Date,
  closed: boolean
): SlotUnavailableReason | null {
  if (row.selectable) return null;
  if (closed) return 'closed';
  // Checked before emptiness so a lunch slot that is both over and sold out
  // reads as over: the customer can act on neither, but "already served" is the
  // truer explanation of the two.
  if (isSlotInPast(date, row.slot, now)) return 'past';
  if (row.seatsRemaining === 0) return 'full';
  return 'party-too-large';
}

/**
 * Labels *why* each slot cannot be picked without re-deciding *whether* it can —
 * `selectable` still comes only from buildSlotAvailability. The distinction
 * matters to the customer rather than to the booking rules: "already served",
 * "sold out" and "too small for your party" are three different situations, and
 * only the last one is something they can act on, by booking for fewer people.
 */
export function describeSlots(
  rows: readonly SlotAvailability[],
  date: Date,
  now: Date
): SlotView[] {
  const closed = isClosedDate(date);
  return rows.map((row) => ({
    ...row,
    unavailableReason: reasonFor(row, date, now, closed),
  }));
}

// ---------- Phone numbers ----------

/**
 * The only characters a phone number may contain besides digits: the grouping
 * marks Thai customers actually type ('081-234-5678', '(02) 123 4567'). Every
 * other character — letters, '+', Thai script, punctuation — makes the input a
 * typo rather than a formatted number, and is rejected outright.
 */
const PHONE_ALLOWED_CHARS = /^[0-9\s()-]+$/;

/**
 * Reduces a phone number to the canonical digits-only form that gets STORED.
 * The database keys both staff call-backs and the per-phone rate limit off this
 * form, so '081-234-5678' and '0812345678' have to collapse to one string rather
 * than being treated as two customers. Mirrors the `regexp_replace` in the
 * `book_slot` SQL function.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Accepts a 9- or 10-digit Thai number, optionally written with spaces,
 * parentheses or hyphens.
 *
 * Deliberately stricter than the prototype's version, which stripped EVERY
 * non-digit before counting and so accepted '08x2345678' as valid — scrubbing
 * the typo instead of reporting it. Now that the number is persisted and phoned
 * back by the restaurant, silently accepting a mistyped character is worse than
 * rejecting it, so anything outside PHONE_ALLOWED_CHARS fails.
 */
export function isValidPhone(phone: string): boolean {
  if (!PHONE_ALLOWED_CHARS.test(phone)) return false;
  return /^[0-9]{9,10}$/.test(normalizePhone(phone));
}

export interface SummaryRow {
  label: string;
  value: string;
}

/**
 * The single source of truth for the label/value pairs shown in both the
 * step-3 confirmation summary and the step-4 success screen.
 */
export function buildSummaryRows(state: WizardState, dates: Date[]): SummaryRow[] {
  const d = state.dateIndex !== null ? dates[state.dateIndex] : undefined;

  const rows: SummaryRow[] = [
    { label: 'วันที่', value: d ? formatDate(d) : '' },
    { label: 'เวลา', value: state.timeSlot ? `${state.timeSlot} น.` : '' },
    { label: 'จำนวนผู้ร่วมโต๊ะ', value: `${state.guests} ท่าน` },
    { label: 'ชื่อผู้จอง', value: state.name },
    { label: 'เบอร์โทรศัพท์', value: state.phone },
  ];

  if (state.note) {
    rows.push({ label: 'ความต้องการพิเศษ', value: state.note });
  }

  return rows;
}

// ---------- Submit failures ----------

/**
 * Which piece of the booking the server rejected. Deliberately the app's own
 * vocabulary rather than the server's status strings — mapping one onto the
 * other is bookingApi.ts's job, so a change of wording on the server side stops
 * there instead of reaching the reducer and the Thai copy.
 */
export type BookingFailureField = 'name' | 'phone' | 'note' | 'guests' | 'date' | 'slot';

export type SubmitFailure =
  | { kind: 'slot-just-filled'; seatsRemaining: number }
  | { kind: 'rate-limited' }
  | { kind: 'validation-failed'; field: BookingFailureField }
  | { kind: 'unreachable' };

const FAILURE_FIELD_LABELS: Record<BookingFailureField, string> = {
  name: 'ชื่อผู้จอง',
  phone: 'เบอร์โทรศัพท์',
  note: 'ความต้องการพิเศษ',
  guests: 'จำนวนผู้ร่วมโต๊ะ',
  date: 'วันที่',
  slot: 'ช่วงเวลา',
};

/**
 * The Thai sentence shown for a failed confirmation. It lives next to the
 * failure type so the copy for a new case cannot be forgotten: adding a variant
 * to SubmitFailure without a branch here is a compile error.
 */
export function submitFailureMessage(failure: SubmitFailure, guests: number): string {
  switch (failure.kind) {
    case 'slot-just-filled':
      // Both wordings promise that the contact details survived, because they
      // do — the customer lost a race they had no way of seeing and must not be
      // made to retype anything over it.
      return failure.seatsRemaining > 0
        ? `ขออภัย ช่วงเวลาที่ท่านเลือกเพิ่งมีผู้จองเข้ามา เหลือที่นั่งเพียง ${failure.seatsRemaining} ที่ ซึ่งไม่พอสำหรับ ${guests} ท่าน กรุณาเลือกช่วงเวลาใหม่ หรือลดจำนวนผู้ร่วมโต๊ะ (ข้อมูลผู้จองของท่านยังอยู่ครบ ไม่ต้องกรอกใหม่)`
        : 'ขออภัย ช่วงเวลาที่ท่านเลือกเพิ่งเต็มไปเมื่อสักครู่ กรุณาเลือกช่วงเวลาใหม่ (ข้อมูลผู้จองของท่านยังอยู่ครบ ไม่ต้องกรอกใหม่)';
    case 'rate-limited':
      return 'ระบบได้รับคำขอจองจากท่านถี่เกินไป กรุณารอสักครู่แล้วกดยืนยันการจองอีกครั้ง (ข้อมูลของท่านยังอยู่ครบ)';
    case 'validation-failed':
      return `ข้อมูล “${FAILURE_FIELD_LABELS[failure.field]}” ไม่ถูกต้อง กรุณาตรวจสอบและแก้ไขก่อนยืนยันอีกครั้ง`;
    case 'unreachable':
      return 'ไม่สามารถติดต่อระบบจองได้ในขณะนี้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วกดยืนยันอีกครั้ง (ข้อมูลของท่านยังอยู่ครบ)';
  }
}

// ---------- Wizard state ----------

export type WizardStep = 1 | 2 | 3 | 4;

/**
 * Real per-slot seat figures for the currently selected date. A discriminated
 * union rather than a `seatsTaken` array plus loading/error booleans, so an
 * in-flight or failed fetch can never be mistaken for "every slot is empty" —
 * rendering every slot as bookable after a failed request would take bookings
 * the restaurant cannot honour.
 */
export type AvailabilityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; seatsTaken: SlotSeatsTaken[] };

/** Just the tag, for components that render a state but never read its figures. */
export type AvailabilityStatus = AvailabilityState['status'];

export interface WizardState {
  step: WizardStep;
  dateIndex: number | null;
  timeSlot: string | null;
  guests: number;
  name: string;
  phone: string;
  note: string;
  bookingId: string | null;
  nameError: boolean;
  phoneError: boolean;
  isSubmitting: boolean;
  availability: AvailabilityState;
  submitFailure: SubmitFailure | null;
}

export const initialWizardState: WizardState = {
  step: 1,
  dateIndex: null,
  timeSlot: null,
  guests: 2,
  name: '',
  phone: '',
  note: '',
  bookingId: null,
  nameError: false,
  phoneError: false,
  isSubmitting: false,
  availability: { status: 'idle' },
  submitFailure: null,
};

export type ContactField = 'name' | 'phone' | 'note';

export type WizardAction =
  | { type: 'SELECT_DATE'; dateIndex: number }
  | { type: 'SELECT_TIME'; timeSlot: string }
  | { type: 'CHANGE_GUESTS'; delta: number }
  | { type: 'UPDATE_FIELD'; field: ContactField; value: string }
  | { type: 'GO_TO_STEP'; step: WizardStep }
  | { type: 'VALIDATE_AND_ADVANCE' }
  | { type: 'AVAILABILITY_LOADING' }
  | { type: 'AVAILABILITY_LOADED'; seatsTaken: SlotSeatsTaken[] }
  | { type: 'AVAILABILITY_FAILED' }
  | { type: 'START_SUBMITTING' }
  | { type: 'SUBMIT_SUCCESS'; bookingId: string }
  | { type: 'SUBMIT_FAILED'; failure: SubmitFailure }
  | { type: 'RESET' };
