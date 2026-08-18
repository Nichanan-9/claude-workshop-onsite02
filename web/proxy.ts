// Staff-area route protection + Supabase session refresh.
//
// FILE NAME: this is `proxy.ts`, not `middleware.ts`. The bundled docs for the
// exact Next version in node_modules (16.3.1) say the `middleware` file
// convention is deprecated and renamed to `proxy` as of v16.0.0
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
// "Version history"), with an official codemod `middleware-to-proxy`. The
// exported function must therefore be named `proxy`. Both filenames are still
// recognised by this build (MIDDLEWARE_FILENAME and PROXY_FILENAME in
// next/dist/lib/constants.js), but only this one is undeprecated.
//
// NOT A SECURITY BOUNDARY. Per the Next docs, proxy may be hoisted to a CDN and
// is meant for redirects, so it is treated here as a convenience redirect only:
// /admin and every Server Action re-check the session server-side themselves.
// The real authorization decision lives in those places, not in this file.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env';

const LOGIN_PATH = '/login';
const ADMIN_PATH = '/admin';

export async function proxy(request: NextRequest) {
  // Reassigned inside setAll: a token refresh has to rebuild the response so
  // the rotated cookies ride along on it.
  let response = NextResponse.next({ request });

  // The publishable key, never the secret one: this file only needs to read and
  // refresh the caller's own session.
  const supabase = createServerClient(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // `headers` is the second argument in @supabase/ssr 0.12: the library
        // hands us Cache-Control/Expires/Pragma no-store headers that MUST be
        // copied onto any response carrying refreshed auth cookies, otherwise a
        // CDN can cache one staff member's Set-Cookie and serve their session
        // to someone else.
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    }
  );

  // getClaims(), never getSession(): the Supabase docs warn that the session
  // read out of cookies is not to be trusted in server code, because cookies
  // are attacker-supplied input. getClaims() verifies the JWT signature.
  // It is also awaited before any response is returned, which is what gives a
  // token refresh the chance to write its cookies (see the setAll doc comment
  // in @supabase/ssr's CookieMethodsServer).
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;

  if (pathname.startsWith(ADMIN_PATH) && !isSignedIn) {
    return redirectPreservingCookies(request, response, LOGIN_PATH, pathname);
  }

  if (pathname === LOGIN_PATH && isSignedIn) {
    return redirectPreservingCookies(request, response, ADMIN_PATH);
  }

  return response;
}

// A fresh NextResponse.redirect() would drop any cookies a token refresh just
// set on `response`, silently logging the user out on the very request that
// renewed them — so they are copied across by hand.
function redirectPreservingCookies(
  request: NextRequest,
  response: NextResponse,
  destination: string,
  redirectTo?: string
) {
  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = '';
  if (redirectTo) {
    url.searchParams.set('redirectTo', redirectTo);
  }

  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

// Deliberately NOT the catch-all matcher from the Supabase quickstart. Only the
// staff routes are listed, which guarantees the customer-facing booking form at
// `/` never runs an auth check, never gets a no-store cache header, and never
// pays for a JWT verification — and keeps static assets out entirely.
export const config = {
  matcher: ['/admin', '/admin/:path*', '/login'],
};
