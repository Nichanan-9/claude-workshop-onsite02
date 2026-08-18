// The useActionState contract of the signIn Server Action.
//
// Separated from `actions.ts` for the same reason bookingTypes.ts is separated
// from bookings.ts: a `'use server'` module may export nothing but async
// functions, so the initial state object cannot live there.

/** What the sign-in form renders between submissions. `null` means "nothing went wrong". */
export interface SignInState {
  error: string | null;
}

export const initialSignInState: SignInState = { error: null };
