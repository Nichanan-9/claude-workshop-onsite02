// The booking wizard's state transitions, kept out of the `'use client'` page
// component so they can be unit tested as a plain pure function.

import {
  initialWizardState,
  isValidPhone,
  type WizardAction,
  type WizardState,
} from '@/lib/booking';
import { SEATS_PER_SLOT } from '@/lib/restaurant';

/**
 * The chosen slot, or null once it can no longer seat `guests`.
 *
 * Only the seat clause of buildSlotAvailability is re-checked here: the past and
 * closed clauses do not depend on party size, and the slot could not have been
 * chosen in the first place unless they already passed.
 *
 * Unknown availability counts as "no longer fits" deliberately. Carrying a slot
 * forward that we cannot verify would let the customer reach step 2 holding a
 * booking the restaurant may not be able to honour.
 */
function slotIfStillFits(state: WizardState, guests: number): string | null {
  if (state.timeSlot === null) return null;
  if (state.availability.status !== 'ready') return null;

  const entry = state.availability.seatsTaken.find((row) => row.slot === state.timeSlot);
  const seatsRemaining = Math.max(0, SEATS_PER_SLOT - (entry?.seatsTaken ?? 0));
  return seatsRemaining >= guests ? state.timeSlot : null;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SELECT_DATE':
      // Picking a new date invalidates whatever time slot was chosen for
      // the previous date, so both update atomically in this one case. The
      // seat figures belong to the old date too, hence `loading` rather than
      // stale-but-ready — the caller kicks off the refetch immediately.
      return {
        ...state,
        dateIndex: action.dateIndex,
        timeSlot: null,
        availability: { status: 'loading' },
        submitFailure: null,
      };

    case 'SELECT_TIME':
      return { ...state, timeSlot: action.timeSlot, submitFailure: null };

    case 'CHANGE_GUESTS': {
      const guests = Math.min(12, Math.max(1, state.guests + action.delta));
      return {
        ...state,
        guests,
        // A party that just got smaller cannot stop fitting a slot it already
        // fitted, so only growth is re-checked. Without this the customer could
        // pick a slot with 4 seats left for a party of 2, raise the party to 10,
        // and carry the now-impossible slot into step 2.
        timeSlot: guests > state.guests ? slotIfStillFits(state, guests) : state.timeSlot,
        submitFailure: null,
      };
    }

    case 'UPDATE_FIELD':
      return { ...state, [action.field]: action.value };

    case 'GO_TO_STEP':
      return { ...state, step: action.step, submitFailure: null };

    case 'VALIDATE_AND_ADVANCE': {
      const name = state.name.trim();
      const phone = state.phone.trim();
      const nameError = name.length === 0;
      const phoneError = !isValidPhone(phone);
      if (nameError || phoneError) {
        return { ...state, nameError, phoneError };
      }
      // Normalize on advance so the summary rows never show stray whitespace.
      return {
        ...state,
        name,
        phone,
        note: state.note.trim(),
        nameError: false,
        phoneError: false,
        step: 3,
      };
    }

    case 'AVAILABILITY_LOADING':
      return { ...state, availability: { status: 'loading' } };

    case 'AVAILABILITY_LOADED': {
      const withFigures: WizardState = {
        ...state,
        availability: { status: 'ready', seatsTaken: action.seatsTaken },
      };
      // Fresh figures can retire a slot that was still selectable when it was
      // picked, so the existing choice is re-validated against them rather than
      // trusted.
      return { ...withFigures, timeSlot: slotIfStillFits(withFigures, withFigures.guests) };
    }

    case 'AVAILABILITY_FAILED':
      // The chosen slot goes with the figures that justified it. Leaving a slot
      // selected while the grid shows an error would let the customer advance on
      // a choice nothing currently backs.
      return { ...state, availability: { status: 'error' }, timeSlot: null };

    case 'START_SUBMITTING':
      return { ...state, isSubmitting: true, submitFailure: null };

    case 'SUBMIT_SUCCESS':
      return {
        ...state,
        bookingId: action.bookingId,
        step: 4,
        isSubmitting: false,
      };

    case 'SUBMIT_FAILED': {
      // Every branch below keeps name / phone / note exactly as typed. None of
      // these outcomes is the customer's fault in a way that justifies making
      // them fill the form in again.
      const base: WizardState = {
        ...state,
        isSubmitting: false,
        submitFailure: action.failure,
      };

      if (action.failure.kind === 'slot-just-filled') {
        // Back to step 1 with the slot cleared, and availability marked stale so
        // the grid cannot re-offer the slot that just went; the caller refetches.
        return { ...base, step: 1, timeSlot: null, availability: { status: 'loading' } };
      }

      if (action.failure.kind === 'validation-failed') {
        // Land on whichever step owns the offending field, so the message points
        // at something the customer can actually edit.
        switch (action.failure.field) {
          case 'name':
          case 'phone':
          case 'note':
            return {
              ...base,
              step: 2,
              nameError: action.failure.field === 'name',
              phoneError: action.failure.field === 'phone',
            };
          case 'date':
          case 'slot':
          case 'guests':
            return { ...base, step: 1 };
        }
      }

      // rate-limited and unreachable are both worth retrying from where they
      // are, so the customer stays on the confirmation step.
      return base;
    }

    case 'RESET':
      return initialWizardState;

    default:
      return state;
  }
}
