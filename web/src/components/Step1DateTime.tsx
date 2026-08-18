// Presentational step 1: date / time / guest-count picker. All derived data
// arrives via props — the candidate dates, the per-slot availability, and the
// reason each unavailable slot is unavailable. This component never computes a
// date, a seat count, or whether a slot is bookable.

import {
  THAI_DAYS,
  THAI_MONTHS,
  bangkokCalendarDate,
  type AvailabilityStatus,
  type SlotView,
} from '@/lib/booking';
import { toBangkokDateKey } from '@/lib/restaurant';

// Below this many seats left, a bookable slot says how many are left rather than
// staying silent. High enough to be a useful nudge for a large party, low enough
// that a near-empty service does not look alarming.
const LOW_SEATS_HINT = 10;

interface Step1DateTimeProps {
  dates: Date[];
  dateIndex: number | null;
  timeSlot: string | null;
  slots: SlotView[];
  availabilityStatus: AvailabilityStatus;
  guests: number;
  isNextDisabled: boolean;
  onSelectDate: (index: number) => void;
  onSelectTime: (time: string) => void;
  onChangeGuests: (delta: number) => void;
  onRetryAvailability: () => void;
  onNext: () => void;
}

function TimeSlotButton({
  view,
  selected,
  guests,
  onSelect,
}: {
  view: SlotView;
  selected: boolean;
  guests: number;
  onSelect: (time: string) => void;
}) {
  const { slot, seatsRemaining, unavailableReason } = view;

  if (unavailableReason !== null) {
    // The three unavailable situations read differently on purpose: a strike
    // through only ever means "sold out", a past slot is simply greyed, and a
    // slot the party has outgrown keeps its gold trim and names the shortfall,
    // because that is the one the customer can act on.
    const styles =
      unavailableReason === 'party-too-large'
        ? 'border-gold/50 bg-gold-light/25 text-ink/60'
        : 'border-ink/10 bg-ink/5 text-ink/30';

    const label =
      unavailableReason === 'closed'
        ? 'ร้านปิด'
        : unavailableReason === 'past'
          ? 'เลยเวลาแล้ว'
          : unavailableReason === 'full'
            ? 'เต็มแล้ว'
            : `เหลือ ${seatsRemaining} ที่`;

    return (
      <button
        type="button"
        disabled
        aria-label={`${slot} — ${label}`}
        className={`rounded-md border-2 py-2 px-1 text-sm cursor-not-allowed ${styles}`}
      >
        <span className={unavailableReason === 'full' ? 'line-through' : ''}>{slot}</span>
        <span className="block text-[10px] leading-tight mt-0.5">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      aria-pressed={selected}
      className={`rounded-md border-2 py-2 px-1 text-sm font-medium transition ${
        selected
          ? 'bg-lucky-red text-cream border-lucky-red shadow-gold'
          : 'bg-white border-gold/50 text-ink hover:border-gold'
      }`}
    >
      {slot}
      {seatsRemaining < LOW_SEATS_HINT && (
        <span
          className={`block text-[10px] leading-tight mt-0.5 ${
            selected ? 'text-cream/80' : 'text-lucky-red/80'
          }`}
        >
          เหลือ {seatsRemaining} ที่
        </span>
      )}
      {seatsRemaining >= LOW_SEATS_HINT && (
        // Keeps every button the same height whether or not it carries a hint,
        // so the grid does not jump as availability changes with the party size.
        <span className="block text-[10px] leading-tight mt-0.5" aria-hidden="true">
          &nbsp;
        </span>
      )}
      <span className="sr-only">{` ว่าง ${seatsRemaining} ที่ สำหรับ ${guests} ท่าน`}</span>
    </button>
  );
}

export default function Step1DateTime({
  dates,
  dateIndex,
  timeSlot,
  slots,
  availabilityStatus,
  guests,
  isNextDisabled,
  onSelectDate,
  onSelectTime,
  onChangeGuests,
  onRetryAvailability,
  onNext,
}: Step1DateTimeProps) {
  const hasPartyTooLarge = slots.some((s) => s.unavailableReason === 'party-too-large');

  return (
    <section>
      <h2 className="text-lg md:text-xl font-bold text-deep-red mb-1">
        ขั้นตอนที่ 1 · เลือกวัน เวลา และจำนวนที่นั่ง
      </h2>
      <p className="text-sm text-ink/60 mb-5">
        กรุณาเลือกวันและเวลาที่ท่านสะดวกเข้าใช้บริการ
      </p>

      <div className="mb-6">
        <label className="block text-sm font-semibold text-deep-red mb-2">
          เลือกวันที่
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {dates.map((d, i) => {
            const selected = dateIndex === i;
            // Read in Asia/Bangkok, not through getDay()/getDate()/getMonth():
            // on a UTC host those would label the previous day for anyone
            // browsing before 07:00 Bangkok time.
            const { day, month, weekday } = bangkokCalendarDate(d);
            return (
              <button
                key={toBangkokDateKey(d)}
                type="button"
                onClick={() => onSelectDate(i)}
                className={`rounded-md border-2 py-2 px-1 text-center transition ${
                  selected
                    ? 'bg-lucky-red text-cream border-lucky-red shadow-gold'
                    : 'bg-white border-gold/50 text-ink hover:border-gold'
                }`}
              >
                <div className={`text-[11px] ${selected ? 'text-cream/80' : 'text-ink/50'}`}>
                  {THAI_DAYS[weekday]}
                </div>
                <div className="text-lg font-bold leading-tight">{day}</div>
                <div className={`text-[10px] ${selected ? 'text-cream/80' : 'text-ink/50'}`}>
                  {THAI_MONTHS[month - 1]}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-semibold text-deep-red mb-2">
          เลือกเวลา
        </label>

        {dateIndex === null ? (
          <p className="text-sm text-ink/40 italic">กรุณาเลือกวันที่ก่อน</p>
        ) : availabilityStatus === 'loading' || availabilityStatus === 'idle' ? (
          <p className="flex items-center gap-2 text-sm text-ink/50" aria-live="polite">
            <span
              className="inline-block w-4 h-4 rounded-full border-2 border-gold/40 border-t-deep-red animate-spin"
              aria-hidden="true"
            />
            กำลังตรวจสอบที่นั่งว่าง...
          </p>
        ) : availabilityStatus === 'error' ? (
          // Never fall back to "everything is available" here: an unanswered
          // availability request means we do not know, and guessing yes takes
          // bookings the restaurant cannot honour.
          <div
            className="rounded-md border-2 border-lucky-red/40 bg-lucky-red/5 p-4 text-sm"
            role="alert"
          >
            <p className="text-deep-red font-semibold mb-1">ไม่สามารถตรวจสอบที่นั่งว่างได้</p>
            <p className="text-ink/60 mb-3">
              การเชื่อมต่อขัดข้อง จึงยังไม่ทราบว่าช่วงเวลาใดว่าง กรุณาลองใหม่อีกครั้ง
            </p>
            <button
              type="button"
              onClick={onRetryAvailability}
              className="px-4 py-2 rounded-md font-bold text-deep-red border-2 border-gold hover:bg-gold-light/30 transition"
            >
              ลองใหม่อีกครั้ง
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {slots.map((view) => (
                <TimeSlotButton
                  key={view.slot}
                  view={view}
                  selected={timeSlot === view.slot}
                  guests={guests}
                  onSelect={onSelectTime}
                />
              ))}
            </div>
            <p className="text-xs text-ink/50 mt-2">
              * ขีดฆ่า = เต็มแล้ว · เลยเวลาแล้ว = ให้บริการไปแล้ว
            </p>
            {hasPartyTooLarge && (
              <p className="text-xs text-deep-red mt-1">
                * ช่วงเวลาที่ขึ้นว่า “เหลือ N ที่” มีที่นั่งไม่พอสำหรับ {guests} ท่าน
                กรุณาลดจำนวนผู้ร่วมโต๊ะ หรือเลือกช่วงเวลาอื่น
              </p>
            )}
          </>
        )}
      </div>

      <div className="mb-8">
        <label className="block text-sm font-semibold text-deep-red mb-2">
          จำนวนผู้ร่วมโต๊ะ
        </label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => onChangeGuests(-1)}
            className="w-10 h-10 rounded-full border-2 border-gold text-lucky-red font-bold text-xl hover:bg-gold-light/40 transition"
          >
            −
          </button>
          <span className="text-xl font-bold w-16 text-center">{guests} ท่าน</span>
          <button
            type="button"
            onClick={() => onChangeGuests(1)}
            className="w-10 h-10 rounded-full border-2 border-gold text-lucky-red font-bold text-xl hover:bg-gold-light/40 transition"
          >
            +
          </button>
        </div>
        <p className="text-xs text-ink/50 mt-2">
          หากเพิ่มจำนวนผู้ร่วมโต๊ะแล้วที่นั่งไม่พอ ระบบจะยกเลิกช่วงเวลาที่เลือกไว้ให้อัตโนมัติ
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={isNextDisabled}
          className="px-6 py-3 rounded-md font-bold text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          ถัดไป →
        </button>
      </div>
    </section>
  );
}
