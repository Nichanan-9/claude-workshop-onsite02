import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LoginForm from '@/components/admin/LoginForm';
import StaffHeader from '@/components/admin/StaffHeader';

export const metadata: Metadata = {
  title: 'เข้าสู่ระบบพนักงาน — โรงเตี๊ยมมังกรทอง',
  // Staff sign-in should never be indexed, and the page must not be cached
  // anywhere: it both reads and writes session cookies.
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirectTo } = await searchParams;

  // proxy.ts already bounces a signed-in visitor away from here, but this page
  // does not rely on that: the proxy is a redirect convenience, not the
  // authorization boundary.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    redirect('/admin');
  }

  return (
    <>
      <StaffHeader subtitle="Staff Sign In · ระบบจัดการการจอง" />

      <main className="flex-1 w-full max-w-md mx-auto px-4 py-10 md:py-16">
        <div className="bg-cream double-border rounded-lg shadow-gold p-6 md:p-8 relative">
          <span className="absolute -top-2 -left-2 text-gold text-xl">❖</span>
          <span className="absolute -top-2 -right-2 text-gold text-xl">❖</span>
          <span className="absolute -bottom-2 -left-2 text-gold text-xl">❖</span>
          <span className="absolute -bottom-2 -right-2 text-gold text-xl">❖</span>

          <h2 className="text-lg md:text-xl font-bold text-deep-red mb-1">เข้าสู่ระบบพนักงาน</h2>
          <p className="text-sm text-ink/60 mb-6">
            กรุณาเข้าสู่ระบบเพื่อดูและจัดการรายการจองโต๊ะ
          </p>

          <LoginForm redirectTo={redirectTo ?? '/admin'} />
        </div>

        <p className="text-center text-xs text-ink/50 mt-8">
          <Link href="/" className="underline hover:text-deep-red transition">
            ← กลับไปหน้าจองโต๊ะ
          </Link>
        </p>
      </main>
    </>
  );
}
