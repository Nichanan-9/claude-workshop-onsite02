// Presentational step indicator: three labeled circles ("วัน-เวลา", "ข้อมูลผู้จอง",
// "ยืนยัน") connected by lines, showing done / active / pending styling derived
// purely from the current step number. Mirrors the original renderStepIndicator().

const STEP_LABELS = ['วัน-เวลา', 'ข้อมูลผู้จอง', 'ยืนยัน'];

interface StepIndicatorProps {
  currentStep: number;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center mb-8 select-none">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < currentStep;
        const active = n === currentStep;
        const circleClasses = done
          ? 'bg-lucky-red text-cream border-lucky-red'
          : active
            ? 'bg-cream text-lucky-red border-lucky-red'
            : 'bg-cream text-ink/40 border-ink/20';
        const lineClasses = done ? 'bg-lucky-red' : 'bg-ink/20';
        const isLast = i === STEP_LABELS.length - 1;

        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full border-2 flex items-center justify-center font-bold text-sm ${circleClasses}`}
              >
                {done ? '✓' : n}
              </div>
              <span
                className={`text-[11px] md:text-xs mt-1 block text-center ${
                  active ? 'text-lucky-red font-semibold' : 'text-ink/50'
                }`}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`h-0.5 w-8 md:w-16 mx-1 md:mx-2 mt-[-14px] ${lineClasses}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
