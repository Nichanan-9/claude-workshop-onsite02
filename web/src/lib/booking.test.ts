import { describe, expect, it } from 'vitest';
import {
  DAYS_AHEAD,
  THAI_DAYS,
  bangkokCalendarDate,
  buildDates,
  buildSummaryRows,
  describeSlots,
  formatDate,
  initialWizardState,
  isValidPhone,
  normalizePhone,
  submitFailureMessage,
  type WizardState,
} from '@/lib/booking';
import { SEATS_PER_SLOT, buildSlotAvailability, toBangkokDateKey } from '@/lib/restaurant';

/**
 * A Date whose Asia/Bangkok calendar date is `dateKey`, anchored at midday so it
 * cannot be dragged onto a neighbouring day by either side of the offset. The
 * offset is written into the string so the value is absolute — building these
 * from local date components would make every date assertion below depend on the
 * timezone of whatever machine runs the suite, which is the very bug the
 * functions under test exist to prevent.
 */
function bangkokDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00+07:00`);
}

describe('isValidPhone', () => {
  it('accepts 9- and 10-digit numbers', () => {
    expect(isValidPhone('021234567')).toBe(true);
    expect(isValidPhone('0812345678')).toBe(true);
  });

  it('rejects numbers that are too short or too long', () => {
    expect(isValidPhone('08123456')).toBe(false);
    expect(isValidPhone('08123456789')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('   ')).toBe(false);
  });

  it('accepts the grouping marks people actually type', () => {
    expect(isValidPhone('081-234-5678')).toBe(true);
    expect(isValidPhone('081 234 5678')).toBe(true);
    expect(isValidPhone('(02) 123 4567')).toBe(true);
  });

  it('rejects a string of letters', () => {
    expect(isValidPhone('abcdefghij')).toBe(false);
    expect(isValidPhone('โทรหาผม')).toBe(false);
  });

  it('rejects a mistyped letter inside the digits rather than scrubbing it', () => {
    // BEHAVIOUR CHANGE (persistence wave): the prototype stripped every
    // non-digit before counting, so this passed and the raw, un-normalised
    // string was what would have reached the database. A mistyped character in
    // a number the restaurant has to phone back is a mistake to report, not to
    // silently delete.
    expect(isValidPhone('08x2345678')).toBe(false);
    expect(isValidPhone('081.234.5678')).toBe(false);
  });

  it('rejects a country-code prefix, which this form does not accept', () => {
    // '+' is not a permitted character, and the digits would count 11 anyway.
    expect(isValidPhone('+66 81 234 5678')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('reduces a formatted number to the digits that get stored', () => {
    expect(normalizePhone('081-234-5678')).toBe('0812345678');
    expect(normalizePhone('(02) 123 4567')).toBe('021234567');
    expect(normalizePhone('  0812345678  ')).toBe('0812345678');
  });

  it('leaves an already-canonical number untouched', () => {
    expect(normalizePhone('0812345678')).toBe('0812345678');
  });

  it('is idempotent, so normalising a stored number is a no-op', () => {
    const once = normalizePhone('081 234 5678');
    expect(normalizePhone(once)).toBe(once);
  });
});

describe('bangkokCalendarDate', () => {
  it('reads the fields Bangkok would show, not the host timezone ones', () => {
    // 17:30 UTC on the 18th is already 00:30 on the 19th in Bangkok. A host in
    // UTC reading getDate() here would answer 18.
    expect(bangkokCalendarDate(new Date('2026-08-18T17:30:00Z'))).toEqual({
      year: 2026,
      month: 8,
      day: 19,
      weekday: 3, // Wednesday
    });
  });

  it('numbers months from 1 so they line up with the YYYY-MM-DD key', () => {
    const instant = bangkokDate('2026-01-05');
    expect(bangkokCalendarDate(instant).month).toBe(1);
    expect(toBangkokDateKey(instant)).toBe('2026-01-05');
  });

  it('indexes THAI_DAYS directly', () => {
    // 18 Aug 2026 is a Tuesday.
    expect(THAI_DAYS[bangkokCalendarDate(bangkokDate('2026-08-18')).weekday]).toBe('อ');
  });
});

describe('buildDates', () => {
  // 17:30 UTC is 00:30 the next morning in Bangkok — the exact window in which
  // a UTC host used to build the picker around the wrong day.
  const utcEvening = new Date('2026-08-18T17:30:00Z');

  it('returns DAYS_AHEAD dates', () => {
    expect(buildDates(utcEvening)).toHaveLength(DAYS_AHEAD);
  });

  it('starts from the Bangkok calendar day, not the host UTC day', () => {
    expect(buildDates(utcEvening).map(toBangkokDateKey)).toEqual([
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ]);
  });

  it('labels that first day with the Bangkok weekday', () => {
    // 19 Aug 2026 is a Wednesday. Reading the same instant locally on a UTC
    // host would label it Tuesday the 18th.
    const [first] = buildDates(utcEvening);
    expect(formatDate(first)).toBe('วันพุธที่ 19 ส.ค. 2569');
    expect(THAI_DAYS[bangkokCalendarDate(first).weekday]).toBe('พ');
  });

  it('rolls over the month and the year', () => {
    const keys = buildDates(new Date('2026-12-31T17:00:00Z')).map(toBangkokDateKey);
    expect(keys[0]).toBe('2027-01-01');
    expect(keys[9]).toBe('2027-01-10');
  });

  it('crosses a month end from mid-window', () => {
    const keys = buildDates(bangkokDate('2026-08-28')).map(toBangkokDateKey);
    expect(keys).toContain('2026-08-31');
    expect(keys).toContain('2026-09-01');
    expect(keys[9]).toBe('2026-09-06');
  });

  it('produces instants that survive being read back in any timezone', () => {
    // Every entry sits at 12:00 Bangkok, i.e. half a day from either date
    // boundary, so no offset between UTC-11 and UTC+14 can shift its date.
    for (const d of buildDates(utcEvening)) {
      expect(d.getUTCHours()).toBe(5);
    }
  });
});

describe('formatDate', () => {
  it('renders the Thai day and month names with a Buddhist-era year', () => {
    // 18 Aug 2026 is a Tuesday.
    expect(formatDate(bangkokDate('2026-08-18'))).toBe('วันอังคารที่ 18 ส.ค. 2569');
  });

  it('adds 543 across a year boundary', () => {
    expect(formatDate(bangkokDate('2027-01-01'))).toBe('วันศุกร์ที่ 1 ม.ค. 2570');
  });

  it('gives the same output for any instant on the same Bangkok date', () => {
    // These two instants fall on different UTC dates but the same Bangkok one,
    // and the label is a statement about the Bangkok date.
    expect(formatDate(new Date('2026-08-18T17:30:00Z'))).toBe('วันพุธที่ 19 ส.ค. 2569');
    expect(formatDate(new Date('2026-08-19T05:00:00Z'))).toBe('วันพุธที่ 19 ส.ค. 2569');
  });
});

describe('describeSlots', () => {
  const target = bangkokDate('2026-09-01');
  const beforeTheDay = new Date('2026-08-31T02:00:00Z'); // 09:00 Bangkok, 31 Aug

  const viewsFor = (
    seatsTaken: { slot: string; seatsTaken: number }[],
    partySize: number,
    now: Date
  ) => {
    const rows = buildSlotAvailability(seatsTaken, target, partySize, { now });
    const views = describeSlots(rows, target, now);
    return (slot: string) => {
      const view = views.find((v) => v.slot === slot);
      if (!view) throw new Error(`no view for ${slot}`);
      return view;
    };
  };

  it('leaves a bookable slot unlabelled', () => {
    const at = viewsFor([], 2, beforeTheDay);
    expect(at('18:00').selectable).toBe(true);
    expect(at('18:00').unavailableReason).toBeNull();
  });

  it('labels a sold-out slot as full', () => {
    const at = viewsFor([{ slot: '18:00', seatsTaken: SEATS_PER_SLOT }], 2, beforeTheDay);
    expect(at('18:00').unavailableReason).toBe('full');
  });

  it('separates a slot the party has outgrown from a sold-out one, keeping its seat count', () => {
    // The whole point of the distinction: this customer can still book here by
    // coming with fewer people, so the copy must not read like "sold out".
    const at = viewsFor([{ slot: '18:00', seatsTaken: SEATS_PER_SLOT - 4 }], 10, beforeTheDay);
    expect(at('18:00').unavailableReason).toBe('party-too-large');
    expect(at('18:00').seatsRemaining).toBe(4);
  });

  it('labels an already-served slot as past even when it is also sold out', () => {
    const middayOnTheDay = bangkokDate('2026-09-01');
    const at = viewsFor([{ slot: '11:00', seatsTaken: SEATS_PER_SLOT }], 2, middayOnTheDay);
    expect(at('11:00').unavailableReason).toBe('past');
    expect(at('17:00').unavailableReason).toBeNull();
  });

  it('returns one view per row and never invents selectability', () => {
    const rows = buildSlotAvailability([], target, 2, { now: beforeTheDay });
    const views = describeSlots(rows, target, beforeTheDay);
    expect(views).toHaveLength(rows.length);
    expect(views.map((v) => v.selectable)).toEqual(rows.map((r) => r.selectable));
  });
});

describe('submitFailureMessage', () => {
  it('tells a customer who lost the race how many seats are left', () => {
    const msg = submitFailureMessage({ kind: 'slot-just-filled', seatsRemaining: 3 }, 6);
    expect(msg).toContain('3');
    expect(msg).toContain('6');
    // The promise that nothing has to be retyped is load-bearing copy here.
    expect(msg).toContain('ไม่ต้องกรอกใหม่');
  });

  it('drops the seat count when the slot went completely full', () => {
    const msg = submitFailureMessage({ kind: 'slot-just-filled', seatsRemaining: 0 }, 6);
    expect(msg).toContain('เต็ม');
    expect(msg).not.toContain('เหลือที่นั่งเพียง');
  });

  it('names the offending field for a validation failure', () => {
    expect(submitFailureMessage({ kind: 'validation-failed', field: 'phone' }, 2)).toContain(
      'เบอร์โทรศัพท์'
    );
    expect(submitFailureMessage({ kind: 'validation-failed', field: 'name' }, 2)).toContain(
      'ชื่อผู้จอง'
    );
  });

  it('gives rate limiting and unreachability their own distinct copy', () => {
    const rateLimited = submitFailureMessage({ kind: 'rate-limited' }, 2);
    const unreachable = submitFailureMessage({ kind: 'unreachable' }, 2);
    expect(rateLimited).not.toBe(unreachable);
    expect(rateLimited).toContain('ถี่เกินไป');
    expect(unreachable).toContain('การเชื่อมต่อ');
  });
});

describe('buildSummaryRows', () => {
  const dates = [bangkokDate('2026-08-18'), bangkokDate('2026-08-19')];

  const filled: WizardState = {
    ...initialWizardState,
    dateIndex: 1,
    timeSlot: '18:00',
    guests: 4,
    name: 'สมชาย ใจดี',
    phone: '0812345678',
  };

  it('keeps a stable row order and formats each value', () => {
    expect(buildSummaryRows(filled, dates)).toEqual([
      { label: 'วันที่', value: 'วันพุธที่ 19 ส.ค. 2569' },
      { label: 'เวลา', value: '18:00 น.' },
      { label: 'จำนวนผู้ร่วมโต๊ะ', value: '4 ท่าน' },
      { label: 'ชื่อผู้จอง', value: 'สมชาย ใจดี' },
      { label: 'เบอร์โทรศัพท์', value: '0812345678' },
    ]);
  });

  it('appends the note row last, and only when a note exists', () => {
    const withNote = buildSummaryRows({ ...filled, note: 'ริมหน้าต่าง' }, dates);
    expect(withNote).toHaveLength(6);
    expect(withNote[5]).toEqual({ label: 'ความต้องการพิเศษ', value: 'ริมหน้าต่าง' });

    expect(buildSummaryRows({ ...filled, note: '' }, dates)).toHaveLength(5);
  });

  it('leaves the date and time blank before either has been picked', () => {
    const rows = buildSummaryRows(initialWizardState, dates);
    expect(rows[0].value).toBe('');
    expect(rows[1].value).toBe('');
  });
});
