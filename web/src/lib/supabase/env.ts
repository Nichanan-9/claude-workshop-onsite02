// The two public Supabase settings, read once and checked once.
//
// `process.env.NEXT_PUBLIC_*` is INLINED into the bundle at build time by a
// literal textual match, which is why each name appears spelled out below
// instead of being looked up through a variable — `process.env[name]` would
// compile to an empty value in the browser.

function required(name: string, value: string | undefined): string {
  if (!value) {
    // Names only. A message that echoed the value would put a key into the
    // build log and, for a client bundle, into every visitor's console.
    throw new Error(
      `Missing environment variable ${name}. Set it in web/.env — see the comments there.`
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * The publishable key. Safe to ship to the browser by design: it carries no
 * privileges of its own, so every table it touches is still gated by RLS. The
 * secret key is deliberately absent from this module — this file is imported by
 * client code, and anything read here reaches the browser bundle.
 */
export function supabasePublishableKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
