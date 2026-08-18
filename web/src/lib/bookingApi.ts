// The single place in the client bundle that knows how to reach the server: the
// availability Route Handler and the booking Server Action. Everything else in
// the wizard speaks only the app's own vocabulary (SlotSeatsTaken from
// restaurant.ts, SubmitFailure from booking.ts), so if either endpoint is
// renamed or reshaped, this file is the only edit — which is why the adapters
// below exist at all rather than page.tsx calling fetch directly.

import type { BookingFailureField, SubmitFailure } from '@/lib/booking';
import type { SlotSeatsTaken } from '@/lib/restaurant';
import { createBooking } from '@/app/actions/bookings';

/** Aggregate seat counts per slot for one Bangkok calendar date. No customer data. */
export const AVAILABILITY_ENDPOINT = '/api/availability';

/**
 * What the Server Action is expected to resolve to. This mirrors the four
 * outcomes of the booking contract; the database's own status strings
 * (`slot_full`, `invalid_phone`, `rate_limited_ip`, …) are the action's business,
 * not the wizard's.
 */
export type CreateBookingResult =
  | { status: 'success'; reference: string }
  | { status: 'slot-just-filled'; seatsRemaining: number }
  | { status: 'rate-limited' }
  | { status: 'validation-failed'; field: BookingFailureField };

export interface CreateBookingInput {
  /** 'YYYY-MM-DD' as Asia/Bangkok reads it — never a host-local date string. */
  date: string;
  /** 'HH:mm', one of TIME_SLOTS. */
  slot: string;
  partySize: number;
  name: string;
  phone: string;
  note: string;
}

export type SubmitOutcome =
  | { ok: true; reference: string }
  | { ok: false; failure: SubmitFailure };

function seatsTakenOf(row: Record<string, unknown>): number {
  // Both spellings are accepted because the Route Handler may either rename the
  // Postgres column or hand `seats_taken` straight through from
  // slot_availability(). Tolerating both here costs three lines and removes a
  // whole class of cross-task breakage.
  const raw = row.seatsTaken ?? row.seats_taken;
  return typeof raw === 'number' ? raw : Number.NaN;
}

/**
 * Narrows the endpoint's JSON to SlotSeatsTaken[], throwing on anything it does
 * not recognise. Throwing is the point: a silently-empty array would render
 * every slot as wide open and let the restaurant take bookings it cannot honour,
 * so an unreadable response has to surface as the error state instead.
 */
function parseAvailability(payload: unknown): SlotSeatsTaken[] {
  const rows = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && Array.isArray((payload as { slots?: unknown }).slots)
      ? ((payload as { slots: unknown[] }).slots)
      : null;

  if (rows === null) {
    throw new Error('availability response was not a list of slots');
  }

  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) {
      throw new Error('availability row was not an object');
    }
    const record = row as Record<string, unknown>;
    const slot = record.slot;
    const seatsTaken = seatsTakenOf(record);
    if (typeof slot !== 'string' || !Number.isFinite(seatsTaken)) {
      throw new Error('availability row was missing slot or seatsTaken');
    }
    return { slot, seatsTaken };
  });
}

export async function fetchSlotSeatsTaken(dateKey: string): Promise<SlotSeatsTaken[]> {
  // `no-store`: seat counts are the one thing in this app that must never come
  // from a cache — a stale hit is exactly how a customer gets offered a slot
  // that filled minutes ago.
  const response = await fetch(`${AVAILABILITY_ENDPOINT}?date=${encodeURIComponent(dateKey)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`availability request failed with ${response.status}`);
  }
  return parseAvailability(await response.json());
}

/**
 * Calls the Server Action and flattens its result into the two shapes the
 * wizard cares about. A thrown error — offline, a 500, an action-serialization
 * failure — becomes the `unreachable` failure rather than propagating, so the
 * confirm button can always come back out of its spinner.
 */
export async function submitBooking(input: CreateBookingInput): Promise<SubmitOutcome> {
  let result: CreateBookingResult;
  try {
    result = await createBooking(input);
  } catch {
    return { ok: false, failure: { kind: 'unreachable' } };
  }

  switch (result.status) {
    case 'success':
      return { ok: true, reference: result.reference };
    case 'slot-just-filled':
      return { ok: false, failure: { kind: 'slot-just-filled', seatsRemaining: result.seatsRemaining } };
    case 'rate-limited':
      return { ok: false, failure: { kind: 'rate-limited' } };
    case 'validation-failed':
      return { ok: false, failure: { kind: 'validation-failed', field: result.field } };
  }
}
