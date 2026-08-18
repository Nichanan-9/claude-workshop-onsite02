'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SignInState } from './signInState';

// Only same-origin admin paths may be handed back to the redirect, so a crafted
// ?redirectTo=https://evil.example cannot turn the login form into an open
// redirect that looks like it came from the restaurant.
function safeRedirectTo(value: FormDataEntryValue | null): string {
  const path = typeof value === 'string' ? value : '';
  return path.startsWith('/admin') && !path.startsWith('/admin//') ? path : '/admin';
}

/**
 * Sign-in only. There is deliberately no sign-up action: public sign-up is
 * disabled at the Supabase project level and staff accounts are created by hand
 * in the dashboard, so an endpoint for it here would be dead code at best.
 */
export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const destination = safeRedirectTo(formData.get('redirectTo'));

  if (!email || !password) {
    return { error: 'กรุณากรอกอีเมลและรหัสผ่าน' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: signInErrorMessage(error.code) };
  }

  // Outside the error branch on purpose: redirect() signals by throwing, so it
  // must never sit inside a try/catch that would swallow it.
  redirect(destination);
}

/**
 * The project runs with `mailer_autoconfirm: false`, so a staff account created
 * by hand in the dashboard can exist and still be unable to sign in until its
 * email is confirmed. Supabase reports that as its own error code, and it must
 * NOT be flattened into "wrong password" — a staff member typing the correct
 * password would otherwise be stuck with no idea what to fix.
 */
function signInErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'email_not_confirmed':
      return 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณาเปิดลิงก์ยืนยันที่ส่งไปในอีเมล หรือให้ผู้ดูแลระบบยืนยันอีเมลนี้ให้ในหน้า Supabase Dashboard แล้วลองอีกครั้ง';
    case 'invalid_credentials':
      return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    case 'user_banned':
      return 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
    case 'over_request_rate_limit':
      return 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
    default:
      return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
  }
}
