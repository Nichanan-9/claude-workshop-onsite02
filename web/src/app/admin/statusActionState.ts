// The useActionState contract of the updateBookingStatus Server Action.
//
// This lives in its own module for the same reason bookingTypes.ts does:
// `actions.ts` carries the `'use server'` directive, and such a module may
// export nothing but async functions — a plain object like the initial state
// below is a build error there, not merely a style preference.

/** What the status form renders between submissions. `null` means "nothing went wrong". */
export interface StatusActionState {
  error: string | null;
}

export const initialStatusActionState: StatusActionState = { error: null };
