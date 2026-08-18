import type { ReactNode } from 'react';

interface StaffHeaderProps {
  subtitle: string;
  /** Right-hand slot for the sign-out control; omitted on the login page. */
  action?: ReactNode;
}

/**
 * The staff-area counterpart of the header on the customer booking page. Kept
 * visually identical (ink bar, gold rules, ❖ accents) so it reads as the same
 * restaurant, with the ink background doing the "you are behind the counter"
 * signalling rather than a different palette.
 */
export default function StaffHeader({ subtitle, action }: StaffHeaderProps) {
  return (
    <header className="relative bg-ink text-cream border-b-4 border-gold overflow-hidden">
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #C9A15A 0, #C9A15A 1px, transparent 0, transparent 12px)',
        }}
      />
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-4 relative">
        <div className="flex items-center gap-3">
          <span className="text-2xl text-gold-light select-none">❖</span>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-wide text-gold-light">
              โรงเตี๊ยมมังกรทอง
            </h1>
            <p className="text-[11px] md:text-xs text-cream/60 tracking-[0.2em] mt-0.5 uppercase">
              {subtitle}
            </p>
          </div>
        </div>
        {action}
      </div>
      <div className="h-1 bg-gradient-to-r from-transparent via-gold to-transparent" />
    </header>
  );
}
