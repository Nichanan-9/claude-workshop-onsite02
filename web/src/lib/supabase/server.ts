// Server-side Supabase client for Server Components, Server Actions and Route
// Handlers, wired to Next.js's request cookie store.
//
// This uses the PUBLISHABLE key, not the secret one, deliberately. The
// publishable key carries no privileges of its own, so every statement it issues
// is still filtered by RLS and by the table grants in supabase/schema.sql:
// the customer path can call `book_slot` and `slot_availability` and nothing
// else, and the staff path sees bookings only because a signed-in session makes
// it `authenticated`. Reaching for the BYPASSRLS secret key would silently turn
// off the only thing standing between a bug and every customer's phone number.

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env';

/**
 * A NEW client per request — never hoist this into a module-level constant.
 * The client holds the caller's session, so one shared instance would let one
 * visitor's request answer with another visitor's identity.
 *
 * `await` is required: `cookies()` is async in this version of Next.js.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Setting a cookie throws during a Server Component render, where the
          // response headers are already committed. That is expected and not an
          // error: a token refreshed on such a request is written back by
          // middleware instead, which runs before any rendering. Swallowing it
          // here is the documented pattern — rethrowing would break every page
          // that merely reads data.
        }
      },
    },
  });
}
