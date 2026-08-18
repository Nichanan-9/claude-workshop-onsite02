'use server';

// The write half of the booking flow, and the only path in the app that creates
// a booking.
//
// A SERVER ACTION rather than a Route Handler because of the per-IP rate limit:
// `book_slot` cannot see the caller's address (Postgres only sees the Supabase
// pooler), so the IP has to be read from the request headers and passed in. A
// browser caller could put any string it liked in that argument and rotate it
// per request, which is why supabase/schema.sql states the requirement in the
// booking_attempt comment — the value must be produced somewhere the customer
// cannot reach.
//
// VALIDATION IS THE DATABASE'S JOB, not this file's. `book_slot` already checks
// party size, name, phone, note length, slot membership, closures and past
// slots, atomically and under the same advisory lock as the capacity check, so
// re-checking any of that here would be a second copy that can only drift. The
// two checks below are the ones the database genuinely cannot make: it knows
// nothing about DAYS_AHEAD, the window the date picker renders.

import { headers } from 'next/headers';
import { isValidDateKey, isWithinBookingWindow } from '@/lib/restaurant';
import { createClient } from '@/lib/supabase/server';
import {
  isBookSlotPayload,
  type BookSlotArgs,
  type BookSlotPayload,
} from '@/lib/supabase/databaseContract';
import type { CreateBookingInput, CreateBookingResult } from './bookingTypes';

export type {
  CreateBookingInput,
  CreateBookingResult,
  ValidationReason,
} from './bookingTypes';

/**
 * Attempts one booking and reports which of the four booking outcomes happened.
 *
 * Throws — rather than returning a fifth "the database broke" variant — when the
 * RPC errors or answers with a shape databaseContract.ts does not recognise. The
 * client adapter in bookingApi.ts turns a rejection into its `unreachable`
 * failure, so an infrastructure problem reaches the customer as "we could not
 * reach the booking system", never as a half-parsed success.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  // Read defensively: a Server Action is a public POST endpoint, so the declared
  // parameter type describes what the app's own client sends and guarantees
  // nothing about what actually arrives. This only settles the JSON types the
  // RPC is handed; what the values MEAN is still judged by book_slot.
  const date = asText(input?.date);
  const slot = asText(input?.slot);
  const name = asText(input?.name);
  const phone = asText(input?.phone);
  const note = asText(input?.note).trim();
  // Truncated, not merely coerced: book_slot's capacity check sums the value it
  // was given while the insert casts it to smallint, so a fractional party size
  // would reserve a different number of seats than it counted against the room.
  // A non-numeric value stays NaN, serialises to JSON null, and comes back as
  // invalid_party_size — the same answer a check here would have given.
  const partySize = Math.trunc(Number(input?.partySize));

  if (!isValidDateKey(date)) {
    return { status: 'validation-failed', field: 'date', reason: 'malformed' };
  }

  // The client sends back a date it claims to have been offered. Refusing
  // anything outside the rendered window keeps this from being a way to write
  // bookings into any date at all — book_slot only rejects dates in the past.
  if (!isWithinBookingWindow(date)) {
    return { status: 'validation-failed', field: 'date', reason: 'out_of_window' };
  }

  const args: BookSlotArgs = {
    p_date: date,
    p_slot: slot,
    p_party_size: partySize,
    p_name: name,
    p_phone: phone,
    // SQL NULL for "no note", so an untouched textarea is stored as an absent
    // note rather than an empty string a staff member has to squint at.
    p_note: note === '' ? null : note,
    p_client_ip: await clientIp(),
  };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('book_slot', args);

  if (error) {
    // Server-side only: a Postgres message can name columns and constraints,
    // which is internal detail rather than something a customer needs.
    console.error('book_slot RPC failed', { code: error.code, message: error.message });
    throw new Error('book_slot RPC failed');
  }

  if (!isBookSlotPayload(data)) {
    // Most likely the deployed schema is older than this code — supabase/schema.sql
    // is applied by hand through the SQL Editor.
    console.error('book_slot returned an unrecognised payload');
    throw new Error('book_slot returned an unrecognised payload');
  }

  return toResult(data);
}

// ---------- Database status to booking outcome ----------

/**
 * Translates book_slot's status codes into the app's own vocabulary, so a
 * rewording on the SQL side stops here instead of reaching the reducer and the
 * Thai copy. The switch is exhaustive over BookSlotStatus: adding a code to
 * databaseContract.ts without handling it here is a compile error.
 */
function toResult(payload: BookSlotPayload): CreateBookingResult {
  switch (payload.status) {
    case 'ok':
      return {
        status: 'success',
        reference: payload.booking_ref,
        seatsRemaining: payload.seats_remaining,
      };
    // Not an error: with no temporary seat holds, a slot can legitimately fill
    // while the customer is still typing their name.
    case 'slot_full':
      return { status: 'slot-just-filled', seatsRemaining: payload.seats_remaining };
    case 'rate_limited_ip':
      return {
        status: 'rate-limited',
        scope: 'ip',
        retryAfterSeconds: payload.retry_after_seconds,
      };
    // The per-phone limit is a daily quota, not a rolling window, so there is no
    // number of seconds to offer — the caller is told to stop, not to wait.
    case 'rate_limited_phone':
      return { status: 'rate-limited', scope: 'phone', retryAfterSeconds: null };
    // A closure belongs to the DATE, not to the slot: every slot on that day is
    // gone, so pointing the customer back at the time picker would be a dead end.
    case 'slot_closed':
      return { status: 'validation-failed', field: 'date', reason: 'closed' };
    case 'slot_past':
      return { status: 'validation-failed', field: 'slot', reason: 'past' };
    case 'invalid_slot':
      return { status: 'validation-failed', field: 'slot', reason: 'unknown_slot' };
    case 'invalid_party_size':
      return { status: 'validation-failed', field: 'guests', reason: 'out_of_range' };
    // `invalid_name` covers both an empty name and one over 120 characters; the
    // database does not distinguish them, and the far commoner cause is empty.
    case 'invalid_name':
      return { status: 'validation-failed', field: 'name', reason: 'empty' };
    case 'invalid_phone':
      return { status: 'validation-failed', field: 'phone', reason: 'invalid_format' };
    case 'invalid_note':
      return { status: 'validation-failed', field: 'note', reason: 'too_long' };
  }
}

// ---------- Request headers ----------

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The caller's address, for book_slot's per-IP rate limit.
 *
 * Null when no header carries one, which the SQL treats as "skip that limit":
 * per the booking_attempt comment in schema.sql, a missing IP must never turn
 * into a hard failure for a legitimate customer.
 */
async function clientIp(): Promise<string | null> {
  const requestHeaders = await headers();

  // Left-most entry only. Vercel rewrites that hop to the real peer, while
  // everything to its right was supplied by the client and can be forged — so
  // reading the whole string, or the right-hand end, would let a caller mint a
  // fresh identity per request and walk straight through the limit.
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0].trim();
  if (forwarded) return forwarded;

  return requestHeaders.get('x-real-ip')?.trim() || null;
}
