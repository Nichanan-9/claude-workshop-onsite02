'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  buildDates,
  buildSummaryRows,
  describeSlots,
  initialWizardState,
  submitFailureMessage,
  type ContactField,
  type SlotView,
} from '@/lib/booking';
import { buildSlotAvailability, toBangkokDateKey } from '@/lib/restaurant';
import { fetchSlotSeatsTaken, submitBooking } from '@/lib/bookingApi';
import { wizardReducer } from '@/lib/wizardReducer';
import StepIndicator from '@/components/StepIndicator';
import Step1DateTime from '@/components/Step1DateTime';
import Step2ContactInfo from '@/components/Step2ContactInfo';
import Step3Confirm, { type SummaryRow } from '@/components/Step3Confirm';
import Step4Success from '@/components/Step4Success';

export default function Home() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  // Must only ever run once on the client — never at module load time —
  // so the next DAYS_AHEAD dates never disagree between server and client.
  const dates = useMemo(() => buildDates(), []);

  const selectedDate = state.dateIndex !== null ? dates[state.dateIndex] : null;

  /**
   * Guards against a slow response for a date the customer has already navigated
   * away from landing on the date they are now looking at. Only the most recently
   * requested date key may write into state.
   */
  const latestRequest = useRef<string | null>(null);

  const loadAvailability = useCallback(async (dateKey: string) => {
    latestRequest.current = dateKey;
    dispatch({ type: 'AVAILABILITY_LOADING' });
    try {
      const seatsTaken = await fetchSlotSeatsTaken(dateKey);
      if (latestRequest.current !== dateKey) return;
      dispatch({ type: 'AVAILABILITY_LOADED', seatsTaken });
    } catch {
      if (latestRequest.current !== dateKey) return;
      dispatch({ type: 'AVAILABILITY_FAILED' });
    }
  }, []);

  // Selectability comes wholly from buildSlotAvailability; describeSlots only
  // labels *why* the unselectable ones are unselectable. `new Date()` is read
  // here rather than at module scope, and this memo never runs on the server
  // (dateIndex is null until the customer clicks), so it cannot desync hydration.
  const slots: SlotView[] = useMemo(() => {
    if (selectedDate === null || state.availability.status !== 'ready') return [];
    const now = new Date();
    const rows = buildSlotAvailability(
      state.availability.seatsTaken,
      selectedDate,
      state.guests,
      { now }
    );
    return describeSlots(rows, selectedDate, now);
  }, [selectedDate, state.availability, state.guests]);

  // The single call site for the shared row-building logic — the exact same
  // rows array is handed to both the step-3 summary and the step-4 success
  // screen below.
  const rows: SummaryRow[] = buildSummaryRows(state, dates).map(
    (row): SummaryRow => [row.label, row.value]
  );

  const nextStepDisabled = !(state.dateIndex !== null && state.timeSlot !== null);

  const failureMessage =
    state.submitFailure !== null ? submitFailureMessage(state.submitFailure, state.guests) : null;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state.step]);

  function handleSelectDate(dateIndex: number) {
    dispatch({ type: 'SELECT_DATE', dateIndex });
    // Fetched from the handler rather than an effect so re-picking the SAME date
    // still refreshes: an effect keyed on the date would not re-run, leaving the
    // `loading` state SELECT_DATE sets with nothing on its way to replace it.
    void loadAvailability(toBangkokDateKey(dates[dateIndex]));
  }

  function handleRetryAvailability() {
    if (selectedDate === null) return;
    void loadAvailability(toBangkokDateKey(selectedDate));
  }

  function handleFieldChange(field: ContactField, value: string) {
    dispatch({ type: 'UPDATE_FIELD', field, value });
  }

  async function handleConfirm() {
    if (selectedDate === null || state.timeSlot === null) return;

    const dateKey = toBangkokDateKey(selectedDate);
    dispatch({ type: 'START_SUBMITTING' });

    const outcome = await submitBooking({
      date: dateKey,
      slot: state.timeSlot,
      partySize: state.guests,
      name: state.name,
      phone: state.phone,
      note: state.note,
    });

    if (outcome.ok) {
      // The reference is the server's, never a client-generated one: the
      // database owns it and is the only place its uniqueness is enforced.
      dispatch({ type: 'SUBMIT_SUCCESS', bookingId: outcome.reference });
      return;
    }

    dispatch({ type: 'SUBMIT_FAILED', failure: outcome.failure });

    if (outcome.failure.kind === 'slot-just-filled') {
      // The reducer has already sent them back to step 1 with the slot cleared;
      // this refills the grid with the figures that made the booking fail, so the
      // slot that just went is visibly gone rather than offered a second time.
      void loadAvailability(dateKey);
    }
  }

  return (
    <>
      <header className="relative bg-ink text-cream border-b-4 border-gold overflow-hidden">
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, #C9A15A 0, #C9A15A 1px, transparent 0, transparent 12px)',
          }}
        />
        <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-center gap-4 relative">
          <span className="text-2xl md:text-3xl text-gold-light select-none">
            ❖
          </span>
          <div className="text-center">
            <h1 className="text-2xl md:text-3xl font-bold tracking-wide text-gold-light">
              โรงเตี๊ยมมังกรทอง
            </h1>
            <p className="text-[11px] md:text-xs text-cream/60 tracking-[0.2em] mt-1 uppercase">
              Golden Dragon Restaurant · ระบบจองโต๊ะออนไลน์
            </p>
          </div>
          <span className="text-2xl md:text-3xl text-gold-light select-none">
            ❖
          </span>
        </div>
        <div className="h-1 bg-gradient-to-r from-transparent via-gold to-transparent" />
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <StepIndicator currentStep={state.step} />

        <div className="bg-cream double-border rounded-lg shadow-gold p-5 md:p-8 relative">
          <span className="absolute -top-2 -left-2 text-gold text-xl">❖</span>
          <span className="absolute -top-2 -right-2 text-gold text-xl">❖</span>
          <span className="absolute -bottom-2 -left-2 text-gold text-xl">❖</span>
          <span className="absolute -bottom-2 -right-2 text-gold text-xl">❖</span>

          {/* Outside the keyed step wrapper on purpose: a failed confirmation
              usually moves the customer to a different step, and re-mounting the
              banner with that step would fade it in and out again mid-read. */}
          {failureMessage !== null && (
            <div
              className="mb-6 rounded-md border-2 border-lucky-red/50 bg-lucky-red/5 p-4 text-sm text-deep-red"
              role="alert"
            >
              {failureMessage}
            </div>
          )}

          {/* Keyed on the step number so the fade-in animation restarts on
              every step change; only the active step is ever mounted. */}
          <div key={state.step} className="step-view">
            {state.step === 1 && (
              <Step1DateTime
                dates={dates}
                dateIndex={state.dateIndex}
                timeSlot={state.timeSlot}
                slots={slots}
                availabilityStatus={state.availability.status}
                guests={state.guests}
                isNextDisabled={nextStepDisabled}
                onSelectDate={handleSelectDate}
                onSelectTime={(timeSlot) =>
                  dispatch({ type: 'SELECT_TIME', timeSlot })
                }
                onChangeGuests={(delta) =>
                  dispatch({ type: 'CHANGE_GUESTS', delta })
                }
                onRetryAvailability={handleRetryAvailability}
                onNext={() => dispatch({ type: 'GO_TO_STEP', step: 2 })}
              />
            )}

            {state.step === 2 && (
              <Step2ContactInfo
                name={state.name}
                phone={state.phone}
                note={state.note}
                nameError={state.nameError}
                phoneError={state.phoneError}
                onFieldChange={handleFieldChange}
                onBack={() => dispatch({ type: 'GO_TO_STEP', step: 1 })}
                onNext={() => dispatch({ type: 'VALIDATE_AND_ADVANCE' })}
              />
            )}

            {state.step === 3 && (
              <Step3Confirm
                rows={rows}
                isSubmitting={state.isSubmitting}
                onBack={() => dispatch({ type: 'GO_TO_STEP', step: 2 })}
                onConfirm={handleConfirm}
              />
            )}

            {state.step === 4 && (
              <Step4Success
                bookingId={state.bookingId ?? ''}
                rows={rows}
                onReset={() => dispatch({ type: 'RESET' })}
              />
            )}
          </div>
        </div>

        <footer className="text-center text-xs text-ink/50 mt-8 pb-4">
          <p>โรงเตี๊ยมมังกรทอง · 88 ถนนเยาวราช กรุงเทพฯ · โทร. 02-123-4567</p>
          <p className="mt-1">
            เปิดบริการทุกวัน 11:00 - 21:00 น. · การจองจะได้รับการยืนยันทางโทรศัพท์จากทางร้าน
          </p>
        </footer>
      </main>
    </>
  );
}
