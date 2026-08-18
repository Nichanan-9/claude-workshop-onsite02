// Browser-side Supabase client, for use from Client Components.
//
// Nothing in the customer booking flow needs this: bookings are written by a
// Server Action (so the rate-limiting IP is not caller-controlled) and
// availability is read through /api/availability. It exists for the staff side,
// where the sign-in form has to run in the browser to store the session cookies.

import { createBrowserClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env';

/**
 * `createBrowserClient` is internally a singleton per set of arguments, so
 * calling this on every render does not open a new connection or lose the
 * session — no module-level instance to memoise it here.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
