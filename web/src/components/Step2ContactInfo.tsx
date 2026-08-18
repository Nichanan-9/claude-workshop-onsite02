type ContactField = 'name' | 'phone' | 'note';

interface Step2ContactInfoProps {
  name: string;
  phone: string;
  note: string;
  nameError: boolean;
  phoneError: boolean;
  onFieldChange: (field: ContactField, value: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function Step2ContactInfo({
  name,
  phone,
  note,
  nameError,
  phoneError,
  onFieldChange,
  onBack,
  onNext,
}: Step2ContactInfoProps) {
  return (
    <section>
      <h2 className="text-lg md:text-xl font-bold text-deep-red mb-1">ขั้นตอนที่ 2 · ข้อมูลผู้จอง</h2>
      <p className="text-sm text-ink/60 mb-5">กรุณากรอกข้อมูลสำหรับติดต่อยืนยันการจอง</p>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-deep-red mb-1">
          ชื่อ-นามสกุล <span className="text-lucky-red">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onFieldChange('name', e.target.value)}
          placeholder="เช่น สมชาย ใจดี"
          className="w-full px-4 py-3 rounded-md border-2 border-gold/60 bg-white focus:outline-none focus:border-lucky-red transition"
        />
        {nameError && <p className="text-xs text-lucky-red mt-1">กรุณากรอกชื่อ-นามสกุล</p>}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-deep-red mb-1">
          เบอร์โทรศัพท์ <span className="text-lucky-red">*</span>
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => onFieldChange('phone', e.target.value)}
          placeholder="เช่น 0812345678"
          maxLength={10}
          className="w-full px-4 py-3 rounded-md border-2 border-gold/60 bg-white focus:outline-none focus:border-lucky-red transition"
        />
        {phoneError && (
          <p className="text-xs text-lucky-red mt-1">กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)</p>
        )}
      </div>

      <div className="mb-8">
        <label className="block text-sm font-semibold text-deep-red mb-1">
          ความต้องการพิเศษ <span className="text-ink/40 font-normal">(ถ้ามี)</span>
        </label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => onFieldChange('note', e.target.value)}
          placeholder="เช่น ที่นั่งริมหน้าต่าง, ไม่ทานเผ็ด, ฉลองวันเกิด"
          className="w-full px-4 py-3 rounded-md border-2 border-gold/60 bg-white focus:outline-none focus:border-lucky-red transition resize-none"
        />
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 rounded-md font-bold text-deep-red border-2 border-gold hover:bg-gold-light/30 transition"
        >
          ← ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-6 py-3 rounded-md font-bold text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold transition"
        >
          ถัดไป →
        </button>
      </div>
    </section>
  );
}
