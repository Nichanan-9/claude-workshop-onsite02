import { formatCreatedAt } from '@/app/admin/formatBooking';
import {
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  type BookingStatus,
} from '@/app/admin/bookingStatus';
import BookingStatusActions from './BookingStatusActions';

/** One row of `public.bookings` as the admin list selects it. */
export interface BookingRecord {
  booking_ref: string;
  booking_date: string;
  time_slot: string;
  party_size: number;
  customer_name: string;
  customer_phone: string;
  note: string | null;
  status: BookingStatus;
  created_at: string;
}

interface BookingCardProps {
  booking: BookingRecord;
}

export default function BookingCard({ booking }: BookingCardProps) {
  const isCancelled = booking.status === 'cancelled';

  return (
    <li
      className={`bg-white border-2 border-gold/40 rounded-lg p-4 md:p-5 ${
        isCancelled ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-bold text-base md:text-lg text-deep-red tracking-wide">
              {booking.time_slot} น.
            </span>
            <span
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                STATUS_BADGE_CLASSES[booking.status]
              }`}
            >
              {STATUS_LABELS[booking.status]}
            </span>
            <span className="text-xs text-ink/40 font-mono">{booking.booking_ref}</span>
          </div>

          <p className="mt-2 text-sm md:text-base">
            <span className={`font-semibold ${isCancelled ? 'line-through' : ''}`}>
              {booking.customer_name}
            </span>
            <span className="text-ink/50"> · {booking.party_size} ท่าน</span>
          </p>

          <p className="mt-1 text-sm">
            {/* tel: so staff can tap to phone the customer back — the only
                channel by which a booking is ever confirmed. */}
            <a
              href={`tel:${booking.customer_phone}`}
              className="text-deep-red underline hover:text-lucky-red transition"
            >
              {booking.customer_phone}
            </a>
          </p>

          {booking.note && (
            <p className="mt-2 text-sm text-ink/70 border-l-2 border-gold pl-3">
              <span className="text-ink/40">ความต้องการพิเศษ: </span>
              {booking.note}
            </p>
          )}

          <p className="mt-2 text-xs text-ink/40">จองเมื่อ {formatCreatedAt(booking.created_at)}</p>
        </div>

        <div className="shrink-0">
          <BookingStatusActions bookingRef={booking.booking_ref} status={booking.status} />
        </div>
      </div>
    </li>
  );
}
