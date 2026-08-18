// GET /api/availability?date=YYYY-MM-DD
//
// The read half of the booking flow: how many seats are already taken in each of
// the 12 slots on one date. A Route Handler rather than a Server Action because
// this is a read, and because the client re-fetches it whenever the customer
// picks a different date or changes the party size.
//
// PRIVACY: the response is aggregates only — no names, phones, notes, booking
// references, ids, or even a booking count. That is enforced by the database, not
// by this file picking fields: `slot_availability` is the only thing the caller's
// key may read, and it returns nothing but per-slot numbers. The anon role has no
// SELECT privilege on `bookings` at all, so there is no shape of query this
// handler could accidentally write that would expose a customer.

import {
  RESTAURANT_TIME_ZONE,
  SEATS_PER_SLOT,
  isValidDateKey,
  isWithinBookingWindow,
} from '@/lib/restaurant';
import { createClient } from '@/lib/supabase/server';
import { isSlotAvailabilityRows } from '@/lib/supabase/databaseContract';

// CACHING: OFF, deliberately, and this is the whole point of the endpoint.
// Availability is the fastest-changing data in the system, and a stale-cached
// copy would hand two customers the same last four seats — exactly the
// double-booking experience the seat-pool design exists to prevent. Being wrong
// here is worse than being slow, so:
//   * `force-dynamic` keeps the handler from being prerendered or reused. (If
//     Cache Components is ever enabled in next.config.ts this export stops being
//     honoured — reading the request's searchParams below already forces
//     request-time execution, so the behaviour holds either way.)
//   * `Cache-Control: no-store` on every response tells browsers and any CDN or
//     proxy in front of the app the same thing. The route config alone does not
//     reach them.
export const dynamic = 'force-dynamic';

/** One slot's public availability. `seatsTaken` is what feeds `buildSlotAvailability()`. */
export interface AvailabilitySlot {
  slot: string;
  seatsTaken: number;
  seatsRemaining: number;
  isPast: boolean;
}

/** The 200 response body. Exported for the client that consumes this endpoint. */
export interface AvailabilityResponse {
  date: string;
  timeZone: string;
  seatsPerSlot: number;
  isClosed: boolean;
  slots: AvailabilitySlot[];
}

/** The 4xx/5xx response body. `error` is a stable machine-readable code. */
export interface AvailabilityError {
  error: 'missing_date' | 'malformed_date' | 'out_of_window' | 'unavailable';
  message: string;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function fail(error: AvailabilityError['error'], message: string, status: number): Response {
  return Response.json({ error, message } satisfies AvailabilityError, {
    status,
    headers: NO_STORE,
  });
}

export async function GET(request: Request): Promise<Response> {
  const date = new URL(request.url).searchParams.get('date');

  if (!date) {
    return fail('missing_date', 'ต้องระบุพารามิเตอร์ date ในรูปแบบ YYYY-MM-DD', 400);
  }

  // Shape first, then meaning. Rejecting '2026-02-30' here rather than letting
  // Postgres raise a date-parse error keeps a malformed request a 400 with a
  // named code instead of a 500.
  if (!isValidDateKey(date)) {
    return fail('malformed_date', 'พารามิเตอร์ date ต้องอยู่ในรูปแบบ YYYY-MM-DD', 400);
  }

  // Out-of-window dates are refused rather than answered with an all-empty
  // result. Answering would make this a general-purpose probe of the booking
  // table across any date, and it would also let the UI silently render a date
  // that can never be booked.
  if (!isWithinBookingWindow(date)) {
    return fail('out_of_window', 'วันที่อยู่นอกช่วงที่เปิดให้จอง', 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('slot_availability', { p_date: date });

  if (error) {
    // Logged server-side only: a Postgres message can name columns and
    // constraints, which is internal detail rather than something a caller needs.
    console.error('slot_availability RPC failed', { code: error.code, message: error.message });
    return fail('unavailable', 'ไม่สามารถตรวจสอบที่นั่งว่างได้ กรุณาลองใหม่', 503);
  }

  if (!isSlotAvailabilityRows(data)) {
    // Most likely the deployed schema is older than this code — supabase/schema.sql
    // is applied by hand through the SQL Editor.
    console.error('slot_availability returned an unrecognised row shape');
    return fail('unavailable', 'ไม่สามารถตรวจสอบที่นั่งว่างได้ กรุณาลองใหม่', 503);
  }

  const body: AvailabilityResponse = {
    date,
    timeZone: RESTAURANT_TIME_ZONE,
    // Echoed so the client can render "x of y seats left" without hard-coding a
    // capacity that would silently disagree if the dining room is re-laid-out.
    seatsPerSlot: SEATS_PER_SLOT,
    // Every row carries the same value for this date; the flag belongs to the
    // date, so it is lifted out of the rows rather than repeated 12 times.
    isClosed: data[0]?.is_closed ?? false,
    slots: data.map((row) => ({
      slot: row.slot,
      seatsTaken: row.seats_taken,
      seatsRemaining: row.seats_remaining,
      isPast: row.is_past,
    })),
  };

  return Response.json(body, { headers: NO_STORE });
}
