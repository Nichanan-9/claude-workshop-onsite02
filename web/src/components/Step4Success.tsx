import type { SummaryRow } from './Step3Confirm';

interface Step4SuccessProps {
  bookingId: string;
  rows: SummaryRow[];
  onReset: () => void;
}

export default function Step4Success({ bookingId, rows, onReset }: Step4SuccessProps) {
  return (
    <section className="text-center py-4">
      <div className="w-20 h-20 mx-auto rounded-full bg-lucky-red flex items-center justify-center shadow-gold mb-4">
        <span className="text-4xl text-gold-light">✓</span>
      </div>
      <h2 className="text-xl md:text-2xl font-bold text-deep-red mb-1">จองโต๊ะสำเร็จแล้ว!</h2>
      <p className="text-sm text-ink/60 mb-6">
        ขอบพระคุณที่ไว้วางใจโรงเตี๊ยมมังกรทอง ทางร้านจะติดต่อยืนยันอีกครั้งทางโทรศัพท์
      </p>

      <div className="bg-white border-2 border-gold rounded-lg p-5 max-w-sm mx-auto text-left mb-8">
        <p className="text-xs text-ink/50 mb-1 uppercase tracking-wider">เลขที่การจอง</p>
        <p className="text-2xl font-bold text-lucky-red mb-4">{bookingId}</p>
        <dl className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink/50">{label}</dt>
              <dd className="font-medium text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="px-6 py-3 rounded-md font-bold text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold transition"
      >
        จองโต๊ะใหม่อีกครั้ง
      </button>
    </section>
  );
}
