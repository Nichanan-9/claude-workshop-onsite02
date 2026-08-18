// The hand-written TypeScript mirror of the two database functions the app is
// allowed to call. Supabase can generate a `Database` type from a live schema;
// this file is written by hand instead so the contract is reviewable next to the
// code that depends on it, and so the jsonb `book_slot` returns — which a
// generated type would flatten to `Json` — is described precisely.
//
// AUTHORITY: supabase/schema.sql. If a status code or column is added there,
// add it here; a code this file does not know about is treated as an unexpected
// error rather than being guessed at.

/** Every `status` value `book_slot` can return. */
export type BookSlotStatus =
  | 'ok'
  | 'slot_full'
  | 'slot_closed'
  | 'slot_past'
  | 'invalid_slot'
  | 'invalid_party_size'
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_note'
  | 'rate_limited_ip'
  | 'rate_limited_phone';

/**
 * The jsonb payload of a `book_slot` call. `status` is always present; the other
 * keys depend on it, which is why this is a union rather than one type with
 * everything optional — narrowing on `status` then gives real guarantees.
 */
export type BookSlotPayload =
  | { status: 'ok'; booking_ref: string; seats_remaining: number }
  | { status: 'slot_full'; seats_remaining: number }
  | { status: 'rate_limited_ip'; retry_after_seconds: number }
  | {
      status: Exclude<BookSlotStatus, 'ok' | 'slot_full' | 'rate_limited_ip'>;
    };

/** Arguments of `public.book_slot`, named exactly as the function declares them. */
export interface BookSlotArgs {
  p_date: string;
  p_slot: string;
  p_party_size: number;
  p_name: string;
  p_phone: string;
  p_note: string | null;
  p_client_ip: string | null;
}

/** One row of `public.slot_availability(date)`. Aggregates only — no personal data. */
export interface SlotAvailabilityRow {
  slot: string;
  seats_taken: number;
  seats_remaining: number;
  is_past: boolean;
  is_closed: boolean;
}

/**
 * Narrows an untyped RPC result to a `BookSlotPayload`.
 *
 * The check is deliberately structural rather than a blind `as` cast: this value
 * crosses a process boundary, and if the deployed schema is older than this code
 * (the schema is applied by hand through the SQL Editor, so it genuinely can
 * lag) the shape may not be what the types promise. Failing that check turns
 * into a visible "unexpected" result instead of `undefined` reaching the UI as a
 * booking reference.
 */
export function isBookSlotPayload(value: unknown): value is BookSlotPayload {
  if (typeof value !== 'object' || value === null) return false;
  const status = (value as { status?: unknown }).status;
  if (typeof status !== 'string') return false;

  const known: readonly string[] = [
    'ok',
    'slot_full',
    'slot_closed',
    'slot_past',
    'invalid_slot',
    'invalid_party_size',
    'invalid_name',
    'invalid_phone',
    'invalid_note',
    'rate_limited_ip',
    'rate_limited_phone',
  ];
  if (!known.includes(status)) return false;

  if (status === 'ok') {
    return typeof (value as { booking_ref?: unknown }).booking_ref === 'string';
  }
  return true;
}

/** Narrows an untyped RPC result to `slot_availability` rows, for the same reason. */
export function isSlotAvailabilityRows(value: unknown): value is SlotAvailabilityRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as SlotAvailabilityRow).slot === 'string' &&
        typeof (row as SlotAvailabilityRow).seats_taken === 'number'
    )
  );
}
