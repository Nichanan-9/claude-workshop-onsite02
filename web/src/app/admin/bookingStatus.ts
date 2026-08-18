// Single source of truth for how a booking status is named and shown to staff.
// The admin list and the per-booking action form both read from here so a
// status can never be labelled one way in the table and another on a button.

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'รอยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  cancelled: 'ยกเลิกแล้ว',
};

// Confirmed gets the same red gradient as the primary action button elsewhere
// in the app, because it is the strongest/most settled state; cancelled is
// deliberately drained of colour so a full slot reads at a glance.
export const STATUS_BADGE_CLASSES: Record<BookingStatus, string> = {
  pending: 'border-gold bg-gold-light/40 text-deep-red',
  confirmed: 'border-deep-red bg-gradient-to-b from-lucky-red to-deep-red text-cream',
  cancelled: 'border-ink/20 bg-ink/10 text-ink/50',
};

/**
 * Statuses a booking still holds seats in. Mirrors the database's
 * `status <> 'cancelled'` aggregation in slot_availability() — see the note in
 * updateBookingStatus about why only `cancelled` frees seats.
 */
export function holdsSeats(status: BookingStatus): boolean {
  return status !== 'cancelled';
}
