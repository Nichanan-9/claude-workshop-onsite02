'use client';

import { useActionState } from 'react';
import { initialSignInState, signIn } from '@/app/login/actions';

interface LoginFormProps {
  redirectTo: string;
}

export default function LoginForm({ redirectTo }: LoginFormProps) {
  // React 19: useActionState returns the pending flag as its third element, so
  // no local useState is needed to track submission.
  const [state, formAction, pending] = useActionState(signIn, initialSignInState);

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="mb-4">
        <label htmlFor="email" className="block text-sm font-semibold text-deep-red mb-1">
          อีเมล <span className="text-lucky-red">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="เช่น staff@example.com"
          className="w-full px-4 py-3 rounded-md border-2 border-gold/60 bg-white focus:outline-none focus:border-lucky-red transition"
        />
      </div>

      <div className="mb-6">
        <label htmlFor="password" className="block text-sm font-semibold text-deep-red mb-1">
          รหัสผ่าน <span className="text-lucky-red">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full px-4 py-3 rounded-md border-2 border-gold/60 bg-white focus:outline-none focus:border-lucky-red transition"
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="text-sm text-lucky-red bg-lucky-red/5 border border-lucky-red/30 rounded-md px-4 py-3 mb-6"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`w-full px-6 py-3 rounded-md font-bold text-cream bg-gradient-to-b from-lucky-red to-deep-red shadow-gold transition flex items-center justify-center gap-2 ${
          pending ? 'opacity-70 cursor-not-allowed' : ''
        }`}
      >
        {pending ? (
          <>
            <span className="spinner inline-block align-middle" /> กำลังเข้าสู่ระบบ...
          </>
        ) : (
          <span>เข้าสู่ระบบ</span>
        )}
      </button>

      {/* No sign-up link on purpose: staff accounts are created by an
          administrator in the Supabase dashboard, and public sign-up is
          disabled at the project level. */}
      <p className="text-xs text-ink/50 text-center mt-5">
        สำหรับพนักงานร้านเท่านั้น · หากเข้าใช้งานไม่ได้ กรุณาติดต่อผู้ดูแลระบบ
      </p>
    </form>
  );
}
