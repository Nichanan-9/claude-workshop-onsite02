'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { BookingStatus } from './bookingStatus';

export interface StatusActionState {
  error: string | null;
}

export const initialStatusActionState: StatusActionState = { error: null };

/**
 * Moves one booking to `confirmed` or `cancelled`.
 *
 * SEAT ACCOUNTING — verified against supabase/schema.sql, not assumed:
 * `slot_availability(date)` (the aggregate the customer-facing availability path
 * reads) left-joins bookings with `and b.status <> 'cancelled'`, and book_slot's
 * capacity check sums party sizes under the same `status <> 'cancelled'`
 * predicate, with `bookings_capacity_idx` a partial index on that same
 * predicate. So writing `status = 'cancelled'` here genuinely returns the seats
 * to the pool through the exact aggregate customers read — nothing else has to
 * happen, and there is no denormalised seat counter that could drift.
 *
 * The reverse direction is the dangerous one, which is why it is refused below:
 * moving a booking OUT of `cancelled` re-takes its seats while bypassing
 * book_slot's advisory-locked capacity check entirely, and could therefore
 * oversell a slot that filled up in the meantime.
 */
export async function updateBookingStatus(
  prevState: StatusActionState,
  formData: FormData
): Promise<StatusActionState> {
  const bookingRef = String(formData.get('bookingRef') ?? '');
  const nextStatus = String(formData.get('nextStatus') ?? '');

  if (nextStatus !== 'confirmed' && nextStatus !== 'cancelled') {
    return { error: 'คำสั่งไม่ถูกต้อง' };
  }

  // Re-checked here and not merely in proxy.ts: a Server Action is a POST
  // endpoint that can be invoked directly, so it does its own authorization.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    redirect('/login');
  }

  // The status the row must currently be in for this transition to be legal,
  // applied as part of the UPDATE's WHERE clause rather than as a read-then-write
  // so two staff members clicking at once cannot both "win".
  //   pending   -> confirmed
  //   pending | confirmed -> cancelled   (never cancelled -> anything)
  let query = supabase
    .from('bookings')
    .update({ status: nextStatus satisfies BookingStatus })
    .eq('booking_ref', bookingRef);

  query =
    nextStatus === 'confirmed'
      ? query.eq('status', 'pending')
      : query.neq('status', 'cancelled');

  // The row is selected back so a no-op update is distinguishable from a
  // successful one; staff hold `grant select` plus `grant update (status)`, so
  // this needs no extra privilege.
  const { data: updated, error } = await query.select('booking_ref');

  if (error) {
    return { error: 'บันทึกสถานะไม่สำเร็จ กรุณาลองอีกครั้ง' };
  }

  if (!updated || updated.length === 0) {
    return {
      error: 'ไม่สามารถเปลี่ยนสถานะรายการนี้ได้ (อาจมีการเปลี่ยนแปลงไปแล้ว) กรุณารีเฟรชหน้า',
    };
  }

  revalidatePath('/admin');
  return { error: null };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
