export type SummaryRow = [label: string, value: string];

interface Step3ConfirmProps {
  rows: SummaryRow[];
  isSubmitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

export default function Step3Confirm({ rows, isSubmitting, onBack, onConfirm }: Step3ConfirmProps) {
  return (
    <section>
      <h2 className="text-lg md:text-xl font-bold text-deep-red mb-1">ขั้นตอนที่ 3 · ยืนยันการจอง</h2>
      <p className="text-sm text-ink/60 mb-5">กรุณาตรวจสอบรายละเอียดก่อนยืนยัน</p>

      <div className="bg-white border-2 border-dashed border-gold rounded-lg p-5 md:p-6 mb-8">
        <dl className="space-y-3 text-sm md:text-base">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-gold/20 pb-2">
              <dt className="text-ink/50 shrink-0">{label}</dt>
              <dd className="font-semibold text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 rounded-md font-bold text-deep-red border-2 border-gold hover:bg-gold-light/30 transition"
        >
          ← แก้ไขข้อมูล
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className={`px-6 py-3 rounded-md font-bold text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold transition flex items-center gap-2 ${
            isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
          }`}
        >
          {isSubmitting ? (
            <>
              <span className="spinner inline-block align-middle mr-1" /> กำลังดำเนินการ...
            </>
          ) : (
            <span>ยืนยันการจอง</span>
          )}
        </button>
      </div>
    </section>
  );
}
