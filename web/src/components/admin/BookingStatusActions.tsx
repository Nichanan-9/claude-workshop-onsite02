'use client';

import { useActionState } from 'react';
import { initialStatusActionState, updateBookingStatus } from '@/app/admin/actions';
import type { BookingStatus } from '@/app/admin/bookingStatus';

interface BookingStatusActionsProps {
  bookingRef: string;
  status: BookingStatus;
}

export default function BookingStatusActions({
  bookingRef,
  status,
}: BookingStatusActionsProps) {
  const [state, formAction, pending] = useActionState(
    updateBookingStatus,
    initialStatusActionState
  );

  // A cancelled booking has already released its seats; putting it back would
  // re-take them without going through book_slot's capacity check, so there is
  // no control to do it. See the note in actions.ts.
  if (status === 'cancelled') {
    return <p className="text-xs text-ink/40">ยกเลิกแล้ว · ที่นั่งถูกคืนเข้าระบบ</p>;
  }

  return (
    <form action={formAction} className="flex flex-col items-stretch gap-2 sm:items-end">
      <input type="hidden" name="bookingRef" value={bookingRef} />

      <div className="flex gap-2">
        {status === 'pending' && (
          <button
            type="submit"
            name="nextStatus"
            value="confirmed"
            disabled={pending}
            className={`px-4 py-2 rounded-md text-sm font-bold text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold transition ${
              pending ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            ยืนยัน
          </button>
        )}

        <button
          type="submit"
          name="nextStatus"
          value="cancelled"
          disabled={pending}
          // Cancelling frees the seats for other customers and cannot be undone
          // from this screen, so it asks first.
          onClick={(event) => {
            if (!window.confirm(`ยกเลิกการจอง ${bookingRef} ใช่หรือไม่? ที่นั่งจะถูกคืนเข้าระบบ`)) {
              event.preventDefault();
            }
          }}
          className={`px-4 py-2 rounded-md text-sm font-bold text-deep-red border-2 border-gold hover:bg-gold-light/30 transition ${
            pending ? 'opacity-70 cursor-not-allowed' : ''
          }`}
        >
          ยกเลิก
        </button>
      </div>

      {pending && (
        <p className="text-xs text-ink/50 flex items-center gap-2 sm:justify-end">
          <span className="spinner inline-block align-middle border-deep-red/30 border-t-deep-red" />
          กำลังบันทึก...
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-xs text-lucky-red sm:text-right">
          {state.error}
        </p>
      )}
    </form>
  );
}
