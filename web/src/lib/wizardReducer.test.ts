import { describe, expect, it } from 'vitest';
import { initialWizardState, type WizardAction, type WizardState } from '@/lib/booking';
import { SEATS_PER_SLOT } from '@/lib/restaurant';
import { wizardReducer } from '@/lib/wizardReducer';

/**
 * A state that has already loaded real seat figures, leaving `seatsFree` seats
 * in the 18:00 slot with that slot chosen. Every slot re-check below starts from
 * one of these, because a reducer with no availability loaded cannot judge fit
 * and deliberately clears instead.
 */
function readyAt1800(seatsFree: number, over: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState,
    dateIndex: 3,
    timeSlot: '18:00',
    availability: {
      status: 'ready',
      seatsTaken: [{ slot: '18:00', seatsTaken: SEATS_PER_SLOT - seatsFree }],
    },
    ...over,
  };
}

describe('SELECT_DATE', () => {
  it('clears the previously chosen time slot', () => {
    const picked: WizardState = { ...initialWizardState, dateIndex: 2, timeSlot: '18:00' };
    const next = wizardReducer(picked, { type: 'SELECT_DATE', dateIndex: 5 });
    expect(next.dateIndex).toBe(5);
    expect(next.timeSlot).toBeNull();
  });

  it('marks the seat figures stale, since they belonged to the old date', () => {
    const next = wizardReducer(readyAt1800(20), { type: 'SELECT_DATE', dateIndex: 5 });
    expect(next.availability).toEqual({ status: 'loading' });
  });

  it('does not mutate the state it was handed', () => {
    const picked: WizardState = { ...initialWizardState, dateIndex: 2, timeSlot: '18:00' };
    wizardReducer(picked, { type: 'SELECT_DATE', dateIndex: 5 });
    expect(picked).toEqual({ ...initialWizardState, dateIndex: 2, timeSlot: '18:00' });
  });
});

describe('SELECT_TIME', () => {
  it('stores the slot without touching the date', () => {
    const next = wizardReducer({ ...initialWizardState, dateIndex: 3 }, {
      type: 'SELECT_TIME',
      timeSlot: '11:30',
    });
    expect(next.timeSlot).toBe('11:30');
    expect(next.dateIndex).toBe(3);
  });
});

describe('CHANGE_GUESTS', () => {
  const bump = (guests: number, delta: number) =>
    wizardReducer({ ...initialWizardState, guests }, { type: 'CHANGE_GUESTS', delta }).guests;

  it('steps up and down by one', () => {
    expect(bump(2, 1)).toBe(3);
    expect(bump(2, -1)).toBe(1);
  });

  it('clamps at 1 and never goes below', () => {
    expect(bump(1, -1)).toBe(1);

    let state: WizardState = { ...initialWizardState, guests: 3 };
    for (let i = 0; i < 10; i++) {
      state = wizardReducer(state, { type: 'CHANGE_GUESTS', delta: -1 });
    }
    expect(state.guests).toBe(1);
  });

  it('clamps at 12 and never goes above', () => {
    expect(bump(12, 1)).toBe(12);

    let state: WizardState = { ...initialWizardState, guests: 10 };
    for (let i = 0; i < 10; i++) {
      state = wizardReducer(state, { type: 'CHANGE_GUESTS', delta: 1 });
    }
    expect(state.guests).toBe(12);
  });
});

describe('UPDATE_FIELD', () => {
  it('writes the raw value of each contact field verbatim', () => {
    let state = wizardReducer(initialWizardState, {
      type: 'UPDATE_FIELD',
      field: 'name',
      value: ' สมชาย ',
    });
    state = wizardReducer(state, { type: 'UPDATE_FIELD', field: 'phone', value: '0812345678' });
    state = wizardReducer(state, { type: 'UPDATE_FIELD', field: 'note', value: 'ริมหน้าต่าง' });

    // No trimming here — that only happens on a successful advance, so the
    // user can still type a space mid-name without it disappearing.
    expect(state.name).toBe(' สมชาย ');
    expect(state.phone).toBe('0812345678');
    expect(state.note).toBe('ริมหน้าต่าง');
  });
});

describe('GO_TO_STEP', () => {
  it('moves to the given step and leaves everything else alone', () => {
    const filled: WizardState = { ...initialWizardState, step: 3, name: 'สมชาย' };
    expect(wizardReducer(filled, { type: 'GO_TO_STEP', step: 2 })).toEqual({
      ...filled,
      step: 2,
    });
  });
});

describe('VALIDATE_AND_ADVANCE', () => {
  const atStep2 = (over: Partial<WizardState>): WizardState => ({
    ...initialWizardState,
    step: 2,
    ...over,
  });

  it('refuses to advance on a blank name', () => {
    const next = wizardReducer(
      atStep2({ name: '   ', phone: '0812345678' }),
      { type: 'VALIDATE_AND_ADVANCE' }
    );
    expect(next.step).toBe(2);
    expect(next.nameError).toBe(true);
    expect(next.phoneError).toBe(false);
  });

  it('refuses to advance on an invalid phone', () => {
    const next = wizardReducer(
      atStep2({ name: 'สมชาย', phone: '0812' }),
      { type: 'VALIDATE_AND_ADVANCE' }
    );
    expect(next.step).toBe(2);
    expect(next.nameError).toBe(false);
    expect(next.phoneError).toBe(true);
  });

  it('flags both fields at once when both are bad', () => {
    const next = wizardReducer(atStep2({}), { type: 'VALIDATE_AND_ADVANCE' });
    expect(next.step).toBe(2);
    expect(next.nameError).toBe(true);
    expect(next.phoneError).toBe(true);
  });

  it('leaves the entered values untrimmed when it refuses', () => {
    const next = wizardReducer(
      atStep2({ name: ' สมชาย ', phone: ' 0812 ' }),
      { type: 'VALIDATE_AND_ADVANCE' }
    );
    expect(next.name).toBe(' สมชาย ');
  });

  it('advances to step 3, trims the stored fields, and clears both error flags', () => {
    const next = wizardReducer(
      atStep2({
        name: '  สมชาย ใจดี  ',
        phone: '  0812345678  ',
        note: '  ริมหน้าต่าง  ',
        nameError: true,
        phoneError: true,
      }),
      { type: 'VALIDATE_AND_ADVANCE' }
    );
    expect(next.step).toBe(3);
    expect(next.name).toBe('สมชาย ใจดี');
    expect(next.phone).toBe('0812345678');
    expect(next.note).toBe('ริมหน้าต่าง');
    expect(next.nameError).toBe(false);
    expect(next.phoneError).toBe(false);
  });
});

describe('submission', () => {
  it('marks the flow as submitting', () => {
    expect(wizardReducer(initialWizardState, { type: 'START_SUBMITTING' }).isSubmitting).toBe(true);
  });

  it('records the booking id, lands on step 4, and stops the spinner', () => {
    const submitting: WizardState = { ...initialWizardState, step: 3, isSubmitting: true };
    const next = wizardReducer(submitting, { type: 'SUBMIT_SUCCESS', bookingId: 'CN-123456' });
    expect(next.bookingId).toBe('CN-123456');
    expect(next.step).toBe(4);
    expect(next.isSubmitting).toBe(false);
  });
});

describe('RESET', () => {
  it('returns the initial state exactly, keeping nothing from the finished booking', () => {
    const finished: WizardState = {
      step: 4,
      dateIndex: 7,
      timeSlot: '19:30',
      guests: 9,
      name: 'สมชาย ใจดี',
      phone: '0812345678',
      note: 'ริมหน้าต่าง',
      bookingId: 'CN-123456',
      nameError: true,
      phoneError: true,
      isSubmitting: true,
      // Both carried over from the finished booking on purpose: stale seat
      // figures belong to a date the customer is no longer looking at, and a
      // leftover failure banner would greet them on a brand-new step 1.
      availability: {
        status: 'ready',
        seatsTaken: [{ slot: '19:30', seatsTaken: SEATS_PER_SLOT - 4 }],
      },
      submitFailure: { kind: 'rate-limited' },
    };

    // Spelled out rather than compared to initialWizardState so a RESET that
    // accidentally spread the old state would fail here.
    expect(wizardReducer(finished, { type: 'RESET' })).toEqual({
      step: 1,
      dateIndex: null,
      timeSlot: null,
      guests: 2,
      name: '',
      phone: '',
      note: '',
      bookingId: null,
      nameError: false,
      phoneError: false,
      isSubmitting: false,
      availability: { status: 'idle' },
      submitFailure: null,
    });
  });
});

describe('an unrecognised action', () => {
  it('leaves the state untouched', () => {
    const filled: WizardState = { ...initialWizardState, step: 2, name: 'สมชาย' };
    const bogus = { type: 'NOT_AN_ACTION' } as unknown as WizardAction;
    expect(wizardReducer(filled, bogus)).toBe(filled);
  });
});
