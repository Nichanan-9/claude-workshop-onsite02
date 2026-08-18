import { describe, expect, it } from 'vitest';
import { DAYS_AHEAD, TIME_SLOTS } from '@/lib/booking';
import {
  SEATS_PER_SLOT,
  bookingWindowDateKeys,
  buildSlotAvailability,
  isClosedDate,
  isSlotInPast,
  isSlotKeyInPast,
  isValidDateKey,
  isValidTimeSlot,
  isWithinBookingWindow,
  toBangkokDateKey,
} from '@/lib/restaurant';

/**
 * The instant at which the Bangkok wall clock reads `hhmm` on `dateKey`. The
 * offset is written into the string so the value is absolute — building these
 * from local date components would make every assertion below depend on the
 * timezone of whatever machine runs the suite.
 */
function bangkokInstant(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00+07:00`);
}

/**
 * A Date whose Asia/Bangkok calendar date is `dateKey`. Mid-day, so it cannot
 * be dragged onto a neighbouring day by either side of the offset.
 */
function bangkokDate(dateKey: string): Date {
  return bangkokInstant(dateKey, '12:00');
}

describe('toBangkokDateKey', () => {
  it('reads the calendar date as Bangkok sees it', () => {
    expect(toBangkokDateKey(new Date('2026-08-18T05:00:00Z'))).toBe('2026-08-18');
  });

  it('maps a UTC-evening instant to the NEXT Bangkok day', () => {
    // 17:30 UTC is already 00:30 the following morning in Bangkok. Keying a
    // booking by its UTC date here would file it under the wrong day.
    expect(toBangkokDateKey(new Date('2026-08-18T17:30:00Z'))).toBe('2026-08-19');
    expect(toBangkokDateKey(new Date('2026-08-18T16:30:00Z'))).toBe('2026-08-18');
  });

  it('rolls the month and the year over correctly', () => {
    expect(toBangkokDateKey(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toBangkokDateKey(new Date('2026-01-05T05:00:00Z'))).toBe('2026-01-05');
  });
});

describe('isClosedDate', () => {
  it('matches a listed closure', () => {
    expect(isClosedDate(bangkokDate('2026-02-17'), ['2026-02-17'])).toBe(true);
  });

  it('leaves neighbouring dates open', () => {
    expect(isClosedDate(bangkokDate('2026-02-16'), ['2026-02-17'])).toBe(false);
    expect(isClosedDate(bangkokDate('2026-02-18'), ['2026-02-17'])).toBe(false);
  });

  it('judges the closure by the Bangkok date, not the UTC one', () => {
    // 18:00 UTC on the 16th is already the 17th in Bangkok — a closed day.
    expect(isClosedDate(new Date('2026-02-16T18:00:00Z'), ['2026-02-17'])).toBe(true);
  });

  it('reports every date open while the shipped closure list is empty', () => {
    expect(isClosedDate(bangkokDate('2026-02-17'))).toBe(false);
  });
});

describe('isSlotInPast', () => {
  // 12:00 on the Bangkok wall clock of 18 Aug 2026, pinned rather than read
  // from the clock so none of these assertions depend on when they run.
  const noonBangkok = bangkokInstant('2026-08-18', '12:00');

  it('counts an earlier slot on the same day as past', () => {
    expect(isSlotInPast(bangkokDate('2026-08-18'), '11:00', noonBangkok)).toBe(true);
    expect(isSlotInPast(bangkokDate('2026-08-18'), '11:30', noonBangkok)).toBe(true);
  });

  it('does not count a later slot on the same day as past', () => {
    expect(isSlotInPast(bangkokDate('2026-08-18'), '12:30', noonBangkok)).toBe(false);
    expect(isSlotInPast(bangkokDate('2026-08-18'), '20:00', noonBangkok)).toBe(false);
  });

  it('treats a slot starting exactly now as still bookable', () => {
    expect(isSlotInPast(bangkokDate('2026-08-18'), '12:00', noonBangkok)).toBe(false);
  });

  it('never counts any slot on a future date as past', () => {
    for (const slot of TIME_SLOTS) {
      expect(isSlotInPast(bangkokDate('2026-08-19'), slot, noonBangkok)).toBe(false);
      expect(isSlotInPast(bangkokDate('2026-09-01'), slot, noonBangkok)).toBe(false);
    }
  });

  it('counts every slot on an earlier date as past', () => {
    for (const slot of TIME_SLOTS) {
      expect(isSlotInPast(bangkokDate('2026-08-17'), slot, noonBangkok)).toBe(true);
    }
  });

  it('compares against the Bangkok wall clock, not UTC', () => {
    // 16:30 UTC is 23:30 in Bangkok on the same date: the evening service is
    // over. A UTC comparison would read "16:30" and still offer the 20:00 slot.
    const lateEveningBangkok = new Date('2026-08-18T16:30:00Z');
    expect(isSlotInPast(bangkokDate('2026-08-18'), '20:00', lateEveningBangkok)).toBe(true);
    expect(isSlotInPast(bangkokDate('2026-08-19'), '11:00', lateEveningBangkok)).toBe(false);
  });

  it('handles a reference instant that has already crossed midnight in Bangkok', () => {
    // 17:30 UTC on the 18th is 00:30 on the 19th in Bangkok, so the whole of
    // the 18th is past while the 19th is entirely still to come.
    const afterMidnightBangkok = new Date('2026-08-18T17:30:00Z');
    expect(isSlotInPast(bangkokDate('2026-08-18'), '20:00', afterMidnightBangkok)).toBe(true);
    expect(isSlotInPast(bangkokDate('2026-08-19'), '11:00', afterMidnightBangkok)).toBe(false);
  });
});

describe('buildSlotAvailability', () => {
  const target = bangkokDate('2026-09-01');
  // Well before any slot on the target date, so nothing is past unless a test
  // deliberately arranges it.
  const beforeTheDay = bangkokInstant('2026-08-31', '09:00');

  const bySlot = (rows: ReturnType<typeof buildSlotAvailability>, slot: string) => {
    const row = rows.find((r) => r.slot === slot);
    if (!row) throw new Error(`no availability row for ${slot}`);
    return row;
  };

  it('returns one row per configured slot, in the configured order', () => {
    const rows = buildSlotAvailability([], target, 2, { now: beforeTheDay });
    expect(rows.map((r) => r.slot)).toEqual([...TIME_SLOTS]);
  });

  it('treats a slot nobody has booked as fully available', () => {
    const rows = buildSlotAvailability([{ slot: '11:00', seatsTaken: 8 }], target, 2, {
      now: beforeTheDay,
    });
    expect(bySlot(rows, '17:00')).toEqual({
      slot: '17:00',
      seatsRemaining: SEATS_PER_SLOT,
      selectable: true,
    });
  });

  it('marks a full slot unselectable', () => {
    const rows = buildSlotAvailability([{ slot: '11:00', seatsTaken: SEATS_PER_SLOT }], target, 1, {
      now: beforeTheDay,
    });
    expect(bySlot(rows, '11:00')).toEqual({ slot: '11:00', seatsRemaining: 0, selectable: false });
  });

  it('never reports negative remaining seats if a slot is somehow oversold', () => {
    const rows = buildSlotAvailability(
      [{ slot: '11:00', seatsTaken: SEATS_PER_SLOT + 5 }],
      target,
      1,
      { now: beforeTheDay }
    );
    expect(bySlot(rows, '11:00').seatsRemaining).toBe(0);
  });

  it('refuses a partially-full slot that cannot seat the whole party', () => {
    const seatsTaken = [{ slot: '18:00', seatsTaken: SEATS_PER_SLOT - 3 }];
    const rows = buildSlotAvailability(seatsTaken, target, 6, { now: beforeTheDay });
    expect(bySlot(rows, '18:00')).toEqual({ slot: '18:00', seatsRemaining: 3, selectable: false });
  });

  it('allows a partially-full slot that exactly fits the party', () => {
    const seatsTaken = [{ slot: '18:00', seatsTaken: SEATS_PER_SLOT - 3 }];
    const rows = buildSlotAvailability(seatsTaken, target, 3, { now: beforeTheDay });
    expect(bySlot(rows, '18:00')).toEqual({ slot: '18:00', seatsRemaining: 3, selectable: true });
  });

  it('takes the party size into account, not just whether seats remain', () => {
    const seatsTaken = [{ slot: '19:00', seatsTaken: SEATS_PER_SLOT - 4 }];
    const forFour = buildSlotAvailability(seatsTaken, target, 4, { now: beforeTheDay });
    const forFive = buildSlotAvailability(seatsTaken, target, 5, { now: beforeTheDay });
    expect(bySlot(forFour, '19:00').selectable).toBe(true);
    expect(bySlot(forFive, '19:00').selectable).toBe(false);
  });

  it('marks slots already served today unselectable while still reporting their seats', () => {
    const today = bangkokDate('2026-09-01');
    const middayBangkok = bangkokInstant('2026-09-01', '13:30');
    const rows = buildSlotAvailability([], today, 2, { now: middayBangkok });

    expect(bySlot(rows, '11:00').selectable).toBe(false);
    expect(bySlot(rows, '13:00').selectable).toBe(false);
    expect(bySlot(rows, '17:00').selectable).toBe(true);
    // The seat count is still the truth about the slot; only pickability changes.
    expect(bySlot(rows, '11:00').seatsRemaining).toBe(SEATS_PER_SLOT);
  });

  it('makes every slot unselectable on a closed date, empty seats or not', () => {
    const rows = buildSlotAvailability([], target, 2, {
      now: beforeTheDay,
      closedDates: ['2026-09-01'],
    });
    expect(rows.every((r) => r.selectable)).toBe(false);
    expect(rows.some((r) => r.selectable)).toBe(false);
    expect(rows.every((r) => r.seatsRemaining === SEATS_PER_SLOT)).toBe(true);
  });

  it('ignores figures for slots the restaurant does not offer', () => {
    const rows = buildSlotAvailability([{ slot: '15:00', seatsTaken: 20 }], target, 2, {
      now: beforeTheDay,
    });
    expect(rows).toHaveLength(TIME_SLOTS.length);
    expect(rows.some((r) => r.slot === '15:00')).toBe(false);
  });
});

describe('isValidDateKey', () => {
  it('accepts a well-formed real date', () => {
    expect(isValidDateKey('2026-08-18')).toBe(true);
    expect(isValidDateKey('2028-02-29')).toBe(true); // 2028 is a leap year
  });

  it('rejects a day that does not exist in that month', () => {
    // The reason the check round-trips through a UTC instant rather than just
    // matching the pattern: Date.UTC would roll these forward silently.
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2027-02-29')).toBe(false); // 2027 is not a leap year
  });

  it('rejects anything not in YYYY-MM-DD shape', () => {
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey('18-08-2026')).toBe(false);
    expect(isValidDateKey('2026-8-18')).toBe(false);
    expect(isValidDateKey('2026-08-18T19:00')).toBe(false);
    expect(isValidDateKey('vandaag')).toBe(false);
  });
});

describe('isValidTimeSlot', () => {
  it('accepts every slot on the menu and nothing else', () => {
    for (const slot of TIME_SLOTS) {
      expect(isValidTimeSlot(slot)).toBe(true);
    }
    expect(isValidTimeSlot('15:00')).toBe(false);
    expect(isValidTimeSlot('19:45')).toBe(false);
    expect(isValidTimeSlot('')).toBe(false);
  });
});

describe('bookingWindowDateKeys', () => {
  it('starts on today in Bangkok and runs DAYS_AHEAD days', () => {
    const keys = bookingWindowDateKeys(bangkokInstant('2026-08-18', '12:00'));
    expect(keys).toHaveLength(DAYS_AHEAD);
    expect(keys[0]).toBe('2026-08-18');
    expect(keys[DAYS_AHEAD - 1]).toBe('2026-08-27');
  });

  it('uses the Bangkok day, not the UTC day, late in the evening', () => {
    // 23:30 on 18 Aug in Bangkok is still 16:30 on 18 Aug UTC — but at 00:30 on
    // 19 Aug Bangkok it is 17:30 on 18 Aug UTC, and a host-timezone
    // implementation would open the window on the wrong day.
    const keys = bookingWindowDateKeys(bangkokInstant('2026-08-19', '00:30'));
    expect(keys[0]).toBe('2026-08-19');
  });

  it('rolls over a month boundary without skipping a day', () => {
    const keys = bookingWindowDateKeys(bangkokInstant('2026-08-28', '10:00'));
    expect(keys).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });
});

describe('isWithinBookingWindow', () => {
  const now = bangkokInstant('2026-08-18', '12:00');

  it('accepts today and the last day of the window', () => {
    expect(isWithinBookingWindow('2026-08-18', now)).toBe(true);
    expect(isWithinBookingWindow('2026-08-27', now)).toBe(true);
  });

  it('rejects yesterday and the day after the window closes', () => {
    expect(isWithinBookingWindow('2026-08-17', now)).toBe(false);
    expect(isWithinBookingWindow('2026-08-28', now)).toBe(false);
  });

  it('rejects a date far in the future', () => {
    expect(isWithinBookingWindow('2030-01-01', now)).toBe(false);
  });
});

describe('isSlotKeyInPast', () => {
  it('agrees with isSlotInPast for the same instant', () => {
    const now = bangkokInstant('2026-08-18', '15:00');
    const today = new Date(now);
    for (const slot of TIME_SLOTS) {
      expect(isSlotKeyInPast('2026-08-18', slot, now)).toBe(isSlotInPast(today, slot, now));
    }
  });

  it('treats earlier slots today as past and later ones as bookable', () => {
    const now = bangkokInstant('2026-08-18', '15:00');
    expect(isSlotKeyInPast('2026-08-18', '13:00', now)).toBe(true);
    expect(isSlotKeyInPast('2026-08-18', '17:00', now)).toBe(false);
  });

  it('never treats a slot on a later date as past', () => {
    const now = bangkokInstant('2026-08-18', '20:30');
    expect(isSlotKeyInPast('2026-08-19', '11:00', now)).toBe(false);
  });
});
