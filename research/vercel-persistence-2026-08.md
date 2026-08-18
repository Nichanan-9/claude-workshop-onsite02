# Persistence & runtime options for a Next.js 16 booking app on Vercel

Research date: **2026-08-18**. Every claim below was checked against a live fetch of the source URL listed with it. Anything I could not fetch is marked **UNVERIFIED**.

App under discussion: a small Thai restaurant table-booking wizard, currently a single client-only `index.html`. Goal: persist bookings, enforce real per-slot table capacity, and be correct when two people grab the last table at the same moment.

## Bottom line

- **There is no first-party Vercel Postgres or Vercel KV any more.** Both were retired and existing stores were auto-migrated (Postgres → Neon, KV → Upstash Redis) in **December 2024**. Today you pick a Marketplace integration. Vercel's own storage overview lists only Blob, Global Config, and Marketplace.
- **Recommended stack for this app: Neon Postgres via the Vercel Marketplace + `pg` + `attachDatabasePool` from `@vercel/functions`.** Free tier is 0.5 GB storage / 100 CU-hours per project, and it *force*-suspends after 5 min idle on Free (cannot be disabled) — fine for a booking form, but expect a cold-start on the first booking after a quiet period.
- **Write the booking with a Server Action + `useActionState`** (confirmed current name in Next.js 16.3.1 / React 19), not a Route Handler. Route Handlers are documented as the "backend for frontend" / public-API tool; Server Actions' documented primary purpose is *mutating data from your frontend client*, and they give you field-level error return for free.
- **Solve the last-table race in the database, not in JS.** Put a `UNIQUE (booking_date, time_slot, table_no)` constraint on a seat/slot row and let `INSERT ... ON CONFLICT DO NOTHING` + an empty `RETURNING` be your "slot was taken" signal. That is atomic under concurrency by documented guarantee. If you instead keep the current "count rows then insert if under capacity" shape, Postgres docs say you need **`SERIALIZABLE`** (plus retry on serialization failure) or an explicit lock — `READ COMMITTED` and `REPEATABLE READ` will let both bookings through.
- **Two platform numbers that likely differ from what you remember:** Hobby function max duration is now **300s** (not 10s/60s — those are legacy pre-April-2025 non-Fluid projects), and **Fluid compute is on by default**, which means warm instances share global state, so a module-scope connection pool is the *correct* pattern rather than an anti-pattern.
- **Watch two footguns:** never name the connection string `NEXT_PUBLIC_*` (it gets inlined into the browser bundle at build time, irreversibly, and cannot be un-shipped by rotating the env var alone); and Hobby cron jobs are limited to **once per day** with ±59 min precision, so don't design an auto-expiry job that needs to run hourly.

---

## 1. Current managed relational database options

**Verified. High confidence.**

Vercel's storage overview (`last_updated: 2026-07-29`) lists exactly three storage products, and Postgres is *not* one of them:

- **Vercel Blob** — large file storage
- **Vercel Global Config** — global low-latency config store
- **Vercel Marketplace** — "Find Postgres, KV, NoSQL, and other databases from providers like Neon, Upstash, and AWS"

The dedicated Postgres page states plainly:

> Vercel Postgres is no longer available. If you had an existing Vercel Postgres database, we automatically moved it to Neon in December 2024. For new projects, install a Postgres integration from the Marketplace.

**This contradicted my prior expectation** in one direction and confirmed it in another: I expected Vercel Postgres to still exist as a thin Neon wrapper brand. It does not — the brand is fully gone and `/docs/postgres` is now a two-paragraph pointer at the Marketplace.

Documented Postgres providers on the Marketplace: **Neon, Supabase, AWS Aurora Postgres, Prisma Postgres**. All four support Vercel's in-dashboard database browser (query editor, spreadsheet-style data editor, schema graph — added around 2026-04-06 per the changelog listing).

Provisioning is one command:

```bash
vercel install neon
```

which installs the integration, provisions the resource, connects it to the linked project, and runs `vercel env pull` into `.env.local`. Flags for CI: `vercel install neon --name my-database --plan free -e production -e preview`.

### Free-tier limits for the default recommended option (Neon)

**Verified via one successful fetch of Neon's plans page before further fetches to that host were blocked. Medium-high confidence — see caveat.**

| Limit | Neon Free plan |
| --- | --- |
| Storage | **0.5 GB per project** |
| Compute | **100 CU-hours per project/month** ("enough to run a 0.25 CU compute in a project for 400 hours/month") |
| Projects | **100 per account** |
| Branches | **10 per project** |
| Autoscaling ceiling | up to 2 CU (8 GB RAM) |
| Scale-to-zero / autosuspend | suspends inactive computes after **5 min**; on Free this **cannot be disabled** |
| Snapshots | 1 manual snapshot |
| Network transfer | 5 GB/month |
| Monitoring retention | 1 day |

**"Is a hobby project limited to a certain number of databases?"** — Two separate limits, don't conflate them:
- On the *Vercel* side: Hobby is limited to **200 projects**; I found **no documented cap on the number of Marketplace storage resources** for Hobby. Treat "Hobby is capped at N databases" as **UNVERIFIED**.
- On the *Neon* side: 100 projects/account, 10 branches/project, and the 0.5 GB is **per project**.

**Caveat / process note:** mid-research, further fetches to `neon.com` were declined by the operator (with the question "neon.com เอาไว้ใช้ทำอะไร" — what is neon.com for?). For the record: `neon.com` is Neon's own official site and docs domain; the older `neon.tech` now redirects there. It is the primary source for Neon, and Vercel's docs link to it. Because of that block, the Neon-specific items in §3 below (pooled connection-string hostname form) are marked UNVERIFIED and were **not** filled in from memory.

Sources:
- https://vercel.com/docs/storage
- https://vercel.com/docs/postgres
- https://vercel.com/docs/marketplace-storage
- https://neon.com/docs/introduction/plans
- https://vercel.com/marketplace/neon (fetched; markets a "generous Free Plan" and "plans starting at $0" but publishes **no** numeric limits — do not cite it for numbers)

---

## 2. Current key-value / Redis options

**Verified. High confidence.**

Same story as Postgres. `/docs/redis`:

> Vercel KV is no longer available. If you had an existing Vercel KV store, we automatically moved it to Upstash Redis in December 2024. For new projects, install a Redis integration from the Marketplace.

Marketplace storage docs: "For KV (key-value stores), you can use **Upstash Redis**." Upstash is the only Redis provider Vercel names. Provisioning: `vercel install upstash`. The SDK is `@upstash/redis`; credentials arrive as injected env vars.

### Upstash Redis free tier

**Verified.**

| Limit | Free |
| --- | --- |
| Commands | **500K / month** (~16.7K/day) |
| Max database size | **256 MB** |
| Bandwidth | **10 GB / month** |
| Databases | 1 free database |
| Max request size | **10 MB** |

For this app's likely use (rate-limiting the booking endpoint), 500K commands/month is ample. Note that Vercel's own docs list "rate limiting" as a canonical Redis use case in the storage-selection table, so this is the sanctioned pattern.

Sources:
- https://vercel.com/docs/redis
- https://vercel.com/docs/marketplace-storage
- https://upstash.com/pricing

---

## 3. Connecting to Postgres from Next.js on Vercel — pooling and the runtime question

### What runtime does a Next.js 16 App Router app actually use by default?

**Verified. High confidence. This one contradicted my expectation.**

From the Next.js 16.3.1 route-segment-config reference:

| Option | Type | Default |
| --- | --- | --- |
| `runtime` | `'nodejs' \| 'edge' (deprecated)` | `'nodejs'` |

So: **route handlers, pages, and Server Actions run on Node.js serverless functions by default, and `'edge'` is now marked deprecated in the type itself.** I had expected edge to still be a first-class co-equal option; it is not. You should not be reaching for edge for a database-backed booking form, and Next.js is nudging you away from it generally.

On Vercel those Node.js functions run under **Fluid compute**, which has been **enabled by default for new projects since April 23, 2025**. This materially changes the pooling advice:

> Fluid compute uses a different approach to isolation. Instead of using a microVM for each function invocation, multiple invocations can share the same physical instance (a global state/process) concurrently.

Functions also run **in a single region by default (`iad1`)**, changeable in settings — so put the database in the same region.

### The recommended pooling approach

**Verified. High confidence on the Vercel-side recipe.**

Vercel's KB guide and the `@vercel/functions` reference both prescribe the same thing, and it is **not** the "one connection per invocation, `max: 1`" folklore:

```ts
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

attachDatabasePool(pool);

export default {
  async fetch() {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW()');
      return Response.json(result.rows[0]);
    } finally {
      client.release();
    }
  },
};
```

- **Named package/driver: `pg`, plus `@vercel/functions` for `attachDatabasePool`.**
- `attachDatabasePool` should be called "right after creating a database pool"; it "ensures that idle pool clients are properly released before functions suspend" / "closes idle connections before an instance suspends, which keeps your connection count under control."
- Supported pool types: **PostgreSQL (`pg`), MySQL2, MariaDB, MongoDB, Redis (`ioredis`), Cassandra**, and other compatible pools.
- Create the pool in **global/module scope** so concurrent invocations on a warm instance reuse it.
- Use a **short idle timeout (~5 s)**.
- **Do not set `max: 1`** — the guide is explicit that a max pool size of 1 "does not reduce total connections and harms concurrency in Fluid Compute. Instead, keep the **minimum** pool size to 1."
- Marketplace storage best practices additionally say: "In serverless environments, use connection pooling (e.g., built-in pooling or PgBouncer) to manage database connections efficiently."
- Separate hard limit worth knowing: Vercel Functions have **1,024 file descriptors shared across all concurrent executions**, and DB connections consume them. The limits page explicitly lists "Use connection pooling for database connections" as the mitigation.

### The Neon-specific pieces

- **`@neondatabase/serverless` is the Neon serverless driver**, usable as `import { neon } from '@neondatabase/serverless'` with `const sql = neon(process.env.DATABASE_URL)` for HTTP-style one-shot queries, and it also exports a `Pool` class for pooled/WebSocket use. **Medium confidence** — this is attested by Vercel-side sources (the Neon marketplace listing describes "a low-latency serverless driver"; Vercel search surfaced the import form), but I could not open `neon.com/docs/serverless/serverless-driver` to confirm the HTTP-vs-WebSocket split, the caveats, or the exact API.
- **UNVERIFIED:** the exact pooled connection-string form (whether it is a `-pooler` hostname suffix, a `?pgbouncer=true` query param, or both), the max-connections numbers with and without the pooler, and — importantly for §5 — **whether multi-statement transactions work over the HTTP driver**. Vercel's KB pooling guide makes **no mention** of pooler hostnames, `pgbouncer=true`, or HTTP drivers at all. Confirm these against `neon.com/docs/connect/connection-pooling` and `neon.com/docs/serverless/serverless-driver` before writing transaction code.

> **Design consequence of the UNVERIFIED gap:** the booking write in §5 needs a real multi-statement transaction (`BEGIN` / `ISOLATION LEVEL` / `COMMIT`) or at minimum a single atomic statement. HTTP-per-query drivers classically cannot hold a transaction across statements. **Until that is verified, prefer `pg` + `attachDatabasePool` over the HTTP driver for the write path** — which is also what Vercel's own guidance shows. `@neondatabase/serverless`'s `neon()` HTTP mode is fine for the read-only availability grid.

Sources:
- https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- https://vercel.com/docs/fluid-compute
- https://vercel.com/kb/guide/connection-pooling-with-functions
- https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/marketplace-storage
- https://vercel.com/templates/next.js/vercel-with-neon-postgres

---

## 4. Server Action vs Route Handler for the form write, and field-level validation

**Verified. High confidence. `useActionState` is confirmed, not assumed.**

### Which one

The docs draw a clear line:

- **Server Actions**: "Their primary purpose is to **mutate data** from your frontend client." Created with the `'use server'` directive, invoked via `<form action={...}>`, `<button formAction>`, or a client transition.
- **Route Handlers**: the "Backend for Frontend" pattern — "publicly reachable", "handles any HTTP request", "can return any content type". Recommended for non-mutation requests, webhooks, callback URLs, proxying, and non-HTML content types.

For a booking form submission that writes to Postgres, **Server Action** is the documented idiom. Keep a Route Handler in reserve only if you later need a public booking API for a third party (a POS, a partner site), or a cron endpoint.

### Documented tradeoffs

- **Single roundtrip for mutation + UI update.** "When a Server Action triggers an immediate revalidation, Next.js does the work inside one HTTP request: it runs the action, then re-renders the current route server-side." The response carries both the action's return value *and* a fresh RSC payload. No follow-up fetch needed to show the updated availability grid.
- **Sequential dispatch is the notable downside.** "Next.js dispatches Server Actions one at a time per client." Do not `Promise.all` actions from the client; the docs point you at a Route Handler for parallel non-mutation requests. For a linear 4-step wizard this is a non-issue, arguably a feature.
- **Body size limit: Server Action requests are capped at 1 MB by default** (`serverActions.bodySizeLimit`), which is *stricter* than Vercel's 4.5 MB function payload limit. Irrelevant for a booking form, relevant if you ever attach a photo.
- **Security: an action is a public POST endpoint.** "the route is reachable to anyone who can send the same POST. Treat every action as an untrusted entry point." Framework protections: Origin/Host CSRF check, encrypted action IDs, dead-code elimination of unused actions, closure variable encryption. But: "Framework protections are not a substitute for application-level checks" — you must authenticate/authorize, validate inputs, and "Constrain return values… Shape them to what the UI renders, not raw database records."
- **Deployment gotcha worth designing for:** action IDs rotate on new deploys (at most every 14 days even with unchanged source), so a client on an old build can hit a dead action ID and see "Failed to find Server Action". Recommendation: "Surface the error as a retry path in the UI rather than a hard failure."

### Field-level validation errors — the current API

`useActionState` from `react` is the current hook (React 19 / Next.js 16.3.1). Signature and shape, verbatim from the docs:

```tsx
'use client'

import { useActionState } from 'react'
import { createUser } from '@/app/actions'

const initialState = { message: '' }

export function Signup() {
  const [state, formAction, pending] = useActionState(createUser, initialState)

  return (
    <form action={formAction}>
      <input type="text" id="email" name="email" required />
      <p aria-live="polite">{state?.message}</p>
      <button disabled={pending}>Sign up</button>
    </form>
  )
}
```

Key mechanics:
- Returns a **3-tuple: `[state, formAction, pending]`**. The `pending` boolean is part of `useActionState` itself — you do not need `useFormStatus` unless you want the submit button in a separate component.
- **When you use `useActionState`, the action's signature changes**: it receives `prevState`/`initialState` as its **first** argument and `FormData` as its second: `export async function createUser(initialState, formData)`.
- Server-side validation is done with a schema library (docs use **zod**), returning early with field errors:

```ts
'use server'
const validatedFields = schema.safeParse({ email: formData.get('email') })
if (!validatedFields.success) {
  return { errors: validatedFields.error.flatten().fieldErrors }
}
```

- The component holding the `<form>` must be a **Client Component** to display the errors.
- `useFormStatus` (from `react-dom`) is the alternative for pending state; in React 19 it also exposes `data`, `method`, `action`.
- `useOptimistic` exists for optimistic UI. **Do not use it for the seat grab** — you cannot optimistically know you won the race.
- Sharp caveat the docs flag for schema validation, directly relevant here: "Schema validation (zod or similar) only checks the *shape* of the input." Validating that `time_slot` is a well-formed string does not validate that the slot exists or has capacity. That check is §5's job.

This maps cleanly onto the existing app: the current `state` object → action input; `phone` 9–10 digit check and empty-name check → zod schema returning `fieldErrors`; the existing spinner → `pending`; `generateBookingId()` → replaced by a real DB-generated id.

Sources:
- https://nextjs.org/docs/app/guides/forms
- https://nextjs.org/docs/app/guides/server-actions
- https://nextjs.org/docs/app/guides/backend-for-frontend

---

## 5. The "two users book the last table simultaneously" problem

**Verified against the PostgreSQL manual. High confidence on the isolation-level answer.**

This is the load-bearing correctness question, so here is what the Postgres docs actually say rather than the usual folklore.

### The read-then-write pattern is unsafe at the default isolation level

Postgres defaults to **READ COMMITTED**, where "Each command sees a new snapshot including all committed transactions up to that instant." Two concurrent transactions can both run `SELECT count(*) ... WHERE date=? AND slot=?`, both see 3 of 4 tables booked, and both insert. Neither blocks the other, because **there is no row to lock — the conflict is about a row that does not exist yet** (a phantom).

**REPEATABLE READ does not fix it either.** The manual's own worked example is structurally identical to the booking problem:

> "Suppose that serializable transaction A computes: `SELECT SUM(value) FROM mytab WHERE class = 1;` and then inserts the result (30) as the `value` in a new row with `class = 2`. Concurrently, serializable transaction B computes: `SELECT SUM(value) FROM mytab WHERE class = 2;` and obtains the result 300…"

That is aggregate-then-insert — exactly "count existing bookings, then insert if under capacity". The docs' point is that **REPEATABLE READ would allow both to commit**, while **SERIALIZABLE detects the anomaly and rolls one back**.

So, stated plainly: **if you keep the count-then-insert shape, you need `SERIALIZABLE`.** And with SERIALIZABLE you must handle the rollback — a transaction can fail with a serialization error and the application has to retry it. The manual is explicit that under REPEATABLE READ and SERIALIZABLE, "updating transactions can still fail with serialization errors."

### The three documented options, ranked for this app

**Option A (recommended): unique constraint + `INSERT ... ON CONFLICT`.** Restructure so capacity is expressed as *rows that must be unique*, not a count. Model one row per bookable seat-slot: `UNIQUE (booking_date, time_slot, table_no)`. Then a booking is a single atomic insert, and losing the race is a returned-zero-rows condition, not an exception you have to distinguish from a real error.

The manual's guarantees:
- "`ON CONFLICT DO UPDATE` guarantees an atomic `INSERT` or `UPDATE` outcome; provided there is no independent error, one of those two outcomes is guaranteed, **even under high concurrency**."
- "Only rows that were successfully inserted or updated will be returned" — so with `ON CONFLICT DO NOTHING ... RETURNING id`, **an empty result set is your "someone else got the last table" signal**. No error parsing, no `23505` string matching.
- `conflict_target` is optional for `DO NOTHING` (omitting it handles conflicts with all usable constraints) but **mandatory for `DO UPDATE`**.
- "only `NOT DEFERRABLE` constraints and unique indexes are supported as arbiters."
- Prefer **unique index inference** over `ON CONFLICT ON CONSTRAINT name`: "Inference will continue to work correctly when the underlying index is replaced by another more or less equivalent index."
- One operational caveat: "While `CREATE INDEX CONCURRENTLY` or `REINDEX CONCURRENTLY` is running on a unique index, `INSERT ... ON CONFLICT` statements on the same table may unexpectedly fail with a unique violation." Relevant only during migrations.

This works correctly at the **default READ COMMITTED** — no isolation-level change, no retry loop, no explicit locking. That is why it's the recommendation for a small app.

**Option B: `SERIALIZABLE` + retry.** Keep the natural "count then insert" query, set `BEGIN ISOLATION LEVEL SERIALIZABLE`, and wrap the whole action in a retry-on-serialization-failure loop. Correct, and the manual notes "Serializable transactions are the best performance choice for some environments" when weighed "against the cost and blocking involved in use of explicit locks." Cost: you must write and test the retry path, and a retry inside a Server Action needs care so it stays idempotent.

**Option C: explicit locking.** The manual acknowledges this route: "a Read Committed or Repeatable Read transaction which wants to ensure data consistency may need to take out a lock on an entire table, which could block other users attempting to use that table, or it may use `SELECT FOR UPDATE` or `SELECT FOR SHARE` which not only can block other transactions but cause disk access."

The critical subtlety: **`SELECT ... FOR UPDATE` alone does not solve this problem.** `FOR UPDATE` "causes the rows retrieved by the SELECT statement to be locked as though for update. This prevents them from being locked, modified or deleted by other transactions until the current transaction ends" — it locks *rows that exist*. It cannot lock the absence of a row. To make it work you must lock a **parent row that does exist** — e.g. `SELECT ... FROM slot_capacity WHERE date=? AND slot=? FOR UPDATE`, serializing all bookings for that one slot, then count and insert. That is correct and easy to reason about, and it's a reasonable Option C if you prefer a pre-seeded capacity table.

Note: the explicit-locking page does **not** itself spell out the "row locks don't prevent inserts" caveat — I'm stating that as the direct consequence of its own definition of `FOR UPDATE`. Flagging it so it isn't mistaken for a quotation.

**Advisory locks** also exist ("locks that have application-defined meanings… the system does not enforce their use — it is up to the application to use them correctly") and could serialize per-slot bookings via a hash of `(date, slot)`. Workable, but weaker than a constraint: it protects only code paths that remember to take the lock. A `UNIQUE` constraint protects the data against *every* writer, including a future admin script and the Vercel dashboard data editor.

### Recommended shape

Belt and braces: **Option A as the enforcement mechanism** (unique constraint = the invariant lives in the schema and cannot be bypassed), with a friendly pre-check `SELECT` purely for rendering the availability grid — never as the gate. The grid's `seededFull()` hash in the current mock becomes a real query; the gate becomes the constraint. If the insert returns zero rows, re-render step 1 with "that slot just filled up" and the refreshed grid, which the Server Action can deliver in the same roundtrip via `updateTag`/`revalidatePath` (see §4).

Sources:
- https://www.postgresql.org/docs/current/transaction-iso.html
- https://www.postgresql.org/docs/current/sql-insert.html
- https://www.postgresql.org/docs/current/explicit-locking.html

---

## 6. Environment variables and secrets for the connection string

**Verified. High confidence.**

### How they get set

- Declared at **team level** (all projects) or **project level** (one project), scoped per environment: **Production**, **Preview**, **Custom environments**, **Development**.
- Preview variables apply to any non-production branch, and you can add **branch-specific** overrides: "Any branch-specific variables will override other preview environment variables with the same name."
- Local dev: `.env.local`, or `vercel env pull` to generate it; `vercel dev` downloads Development vars into memory automatically.
- **Marketplace integrations inject the credentials for you** — "Vercel injects connection strings and credentials as environment variables", and integration-added variables are labelled with their source in project settings. So `DATABASE_URL` (or `POSTGRES_URL`) appears without you typing it.
- "Any change you make to environment variables are not applied to previous deployments, they only apply to new deployments." **Rotating a secret requires a redeploy to take effect.**
- Values are "encrypted at rest and visible to any user that has access to the project."
- Size: **64 KB total per deployment** across all variables on Node.js. (Edge runtime is capped at 5 KB *per* variable — another reason not to go edge.)

### Build time vs runtime

- "Your source code can read these values to change behavior during the **Build Step** or during **Function** execution." Both.
- Next.js side: "**By default, environment variables are only available on the server.**" A non-prefixed `DATABASE_URL` is readable in Route Handlers, Server Actions, and Server Components.
- For a value that must be evaluated at **runtime** rather than baked in, read it during dynamic rendering — the docs show `await connection()` from `next/server` before reading `process.env`, since request-time APIs opt the route into dynamic rendering.

### The `NEXT_PUBLIC_` footgun — this is the one to brief the team on

Mechanically, from the Next.js docs:

> In order to make the value of an environment variable accessible in the browser, Next.js can "inline" a value, at build time, into the js bundle that is delivered to the client, **replacing all references to `process.env.[variable]` with a hard-coded value**.

Consequences if someone names the connection string `NEXT_PUBLIC_DATABASE_URL`:

1. The full Postgres credentials are **hard-coded into JavaScript served to every visitor**. Not merely readable by server code — shipped.
2. It is **irreversible for that build**: "After being built, your app will no longer respond to changes to these environment variables… all `NEXT_PUBLIC_` variables will be frozen with the value evaluated at build time." Changing the env var in the Vercel dashboard does **not** scrub the already-deployed bundle. You must rotate the database credential *and* redeploy.
3. It fails silently — there is no warning, no error, no lint. The app works perfectly while leaking.

Mitigations to adopt:
- **Never prefix a credential with `NEXT_PUBLIC_`.** Treat the prefix as meaning "publish this to the internet", because that is literally what it does.
- Mark the connection string as a **sensitive environment variable**: "environment variables whose values are non-readable once created… Vercel stores the variable in an unreadable format." Only available for **Production and Preview** (not Development). To convert an existing variable you must remove and re-add it with the Sensitive option on. You can edit the value but not the key.
- Sensitive values ≥32 characters are **redacted as `[REDACTED]` in build logs**, with an Activity Log event recorded per masked key (key name, project, deployment — never the value). A Postgres URL comfortably exceeds 32 chars.
- Team Owners can enforce this globally: **Security & Privacy → Environment Variable Policies → Enforce Sensitive Environment Variables**, which makes all newly created Production/Preview variables sensitive by default. Worth turning on before anyone hand-adds a database URL.
- Also note `.env*` files are gitignored by the `create-next-app` template by default: "You almost never want to commit these files to your repository."

Sources:
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/environment-variables/sensitive-environment-variables
- https://nextjs.org/docs/app/guides/environment-variables
- https://vercel.com/docs/marketplace-storage

---

## 7. Vercel platform limits a booking app should know

**Verified. High confidence. Two items contradicted expectations.**

### Function execution timeout — **this is the biggest surprise**

With **Fluid compute** (default for new projects since 2025-04-23):

| | Default | Maximum | Extended maximum |
| --- | --- | --- | --- |
| **Hobby** | **300s (5 min)** | **300s (5 min)** | — |
| Pro | 300s | 800s | 1800s (beta) |
| Enterprise | 300s | 800s | 1800s (beta) |

I expected Hobby to be 10s default / 60s max. Those numbers **do still appear** on the limits page, but they are explicitly scoped to legacy projects: "If you have an existing project, deployed to Vercel before April 23rd 2025 and **not using Fluid compute**, Vercel Functions have the following defaults and maximum limits" — Hobby 10s / 60s, Pro 15s / 300s, Enterprise 15s / 900s. **Do not quote 10s for a new 2026 Hobby project.** A booking insert has enormous headroom either way; this mostly matters for not over-engineering around a timeout that no longer exists.

Related: the **Proxied Request Timeout is 120s on all plans**, and edge-runtime functions "must begin sending a response within 25 seconds."

### Request body size

- **4.5 MB** max for the request *or* response body of a Vercel Function; exceeding it returns **413 `FUNCTION_PAYLOAD_TOO_LARGE`**.
- **But Server Actions are capped at 1 MB by default** by Next.js itself (`serverActions.bodySizeLimit`) — the tighter of the two, and the one that actually governs your form submit.

### Cron jobs on the free plan — available, but crippled

| | Cron jobs per project | Minimum interval | Scheduling precision |
| --- | --- | --- | --- |
| **Hobby** | **100** | **Once per day** | **Per-hour (±59 min)** |
| Pro | 100 | Once per minute | Per-minute |
| Enterprise | 100 | Once per minute | Per-minute |

"Cron jobs are included in **all plans**", so yes, available on Hobby — I half-expected them to be Pro-only. But:

> Hobby accounts are limited to cron jobs that run **once per day**. Cron expressions that would run more frequently **will fail during deployment**.

`0 * * * *` or `*/30 * * * *` fail the *deploy*, not just the run — a nasty way to discover this. And "a cron job configured as `0 1 * * *` (every day at 1 am) will trigger anywhere between 1:00 am and 1:59 am."

**Design consequence for auto-expiring old bookings:** do not rely on a cron to define correctness. Expire by comparing timestamps at read time (`WHERE booking_date >= current_date`), and let a once-daily cron do only cosmetic cleanup/archival. That way the ±59 min imprecision and the once-daily floor are harmless, and the app stays correct on Hobby.

### Other Hobby limits worth a glance

General limits: 200 projects; **100 deployments/day**; 100 builds/hour; 1 concurrent deployment; 45 min build time per deployment; 100 MB CLI source upload; 2048 routes/deployment; runtime logs retained only **1 hour** on Hobby (1 day Pro, 3 days Enterprise — plan your debugging accordingly).

Hobby usage allowances: **1 million invocations**, 4 CPU-hrs Active CPU, 360 GB-hrs provisioned memory, 100 GB Fast Data Transfer, up to 10 GB Fast Origin Transfer.

Memory: Hobby is fixed at **2 GB / 1 vCPU** (default *and* maximum); Pro/Enterprise can go to 4 GB / 2 vCPU.

Also: **Hobby teams cannot connect projects to Git repositories owned by Git organizations** — if the restaurant's repo lives in a GitHub org, you need a Team. Easy to trip over on day one.

Sources:
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/limits
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/fluid-compute
- https://nextjs.org/docs/app/guides/server-actions

---

## 8. Running schema migrations as part of a Vercel deploy

**Partially verified. Medium confidence — Vercel has no single canonical "how to migrate" doc page.**

### What is actually documented

There is **no dedicated Vercel docs page on running database migrations**. What exists:

- The **Build Command is fully overridable**, per project or per deployment. "If you'd like to override the Build Command for all deployments in your Project, you can turn on the Override toggle and specify the custom command", or set [`buildCommand`](https://vercel.com/docs/project-configuration/vercel-json#buildcommand) in `vercel.json`. For Next.js, "Vercel checks for the `build` command in `scripts` and uses this to build the project" — so amending the `build` script in `package.json` is the lowest-friction hook.
- **Environment variables are available during the Build Step** ("during the Build Step or during Function execution"), so `DATABASE_URL` is readable by a migration script running there.
- Build constraints: **45 min max build time**, 32 GB disk, shallow git clone (`--depth=10`).
- Provider guides confirm the pattern in practice: the Vercel + Neon template uses Drizzle Kit with `npm run db:generate` / `npm run db:migrate`, and the Prisma KB guide notes the integration adds `DATABASE_URL` for use during the build step to apply migrations.

So the **common documented approach is: run the migration in the build command**, e.g. `"build": "node scripts/migrate.mjs && next build"`.

### The caveats that matter, given the ephemeral build

I did **not** find explicit Vercel documentation on these points, so treat the reasoning as mine, not Vercel's — but they follow from documented behaviour:

1. **Builds are not serialized and not exactly-once.** Hobby allows 1 concurrent deployment (so less exposure), but Pro allows up to 500, and preview branches build independently. A migration in the build step can run concurrently with itself. Your migration runner must therefore take a **lock** and be **idempotent**. Postgres **advisory locks** are the natural fit here (see §5) — `pg_advisory_lock(<constant>)` around the migration run.
2. **A build can succeed after the migration and still not be promoted**, and a failed build after a successful migration leaves the schema ahead of the code. So migrations must be **backward-compatible with the currently-deployed code** (expand/contract: add columns and tables first, remove them only in a later deploy). This is standard practice but easy to skip on a small project.
3. **Preview deployments share the production database unless you give them their own.** Neon's branching (10 branches/project on Free) is the intended answer; otherwise a preview build's migration mutates production schema. Worth a decision up front.
4. **Build-time network access to the database.** Provider guides clearly rely on it working, so it works for Marketplace-provisioned databases. **UNVERIFIED:** whether the build environment's egress IP is stable or whether IP-allowlisted databases need special handling. Not an issue for Neon/Upstash defaults.

### Lightweight option, no heavy ORM

Given this project's stated aversion to build tooling and dependencies, you do not need Prisma or Drizzle. A minimal runner is about 30 lines and uses only `pg`, which you already need for §3:

- A `migrations/` directory of numbered plain `.sql` files (`001_create_bookings.sql`, …). Plain SQL also means the `UNIQUE` constraint from §5 is right there in reviewable text, not generated.
- A `schema_migrations(version text primary key, applied_at timestamptz default now())` table.
- A script that: connects, `pg_advisory_lock`, `CREATE TABLE IF NOT EXISTS schema_migrations`, reads applied versions, and for each unapplied file in order runs the SQL **and** the `INSERT INTO schema_migrations` inside **one transaction**, then unlocks.
- Wire it as `"build": "node scripts/migrate.mjs && next build"`.

This keeps the "no framework, no heavy tooling" spirit of the existing project while getting real DDL versioning. If you'd rather avoid touching the build step at all, the Vercel dashboard's **Marketplace database query editor** (supported for Neon, Supabase, Prisma Postgres, AWS Aurora Postgres — see §1) lets you paste the initial `CREATE TABLE` once by hand. Perfectly reasonable for a one-table app that will rarely change shape; it just leaves no audit trail and no path to reproduce the schema in a fresh environment.

Sources:
- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/docs/limits
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/marketplace-storage
- https://vercel.com/templates/next.js/vercel-with-neon-postgres
- https://vercel.com/kb/guide/nextjs-prisma-postgres (surfaced via search; not individually fetched — **treat its details as UNVERIFIED**)

---

## Every URL fetched

Fetched and read in full:

1. https://vercel.com/docs/storage
2. https://vercel.com/docs/postgres
3. https://vercel.com/docs/redis
4. https://vercel.com/docs/marketplace-storage
5. https://vercel.com/docs/fluid-compute
6. https://vercel.com/docs/functions/limitations
7. https://vercel.com/docs/limits
8. https://vercel.com/docs/cron-jobs/usage-and-pricing
9. https://vercel.com/docs/environment-variables
10. https://vercel.com/docs/environment-variables/sensitive-environment-variables
11. https://vercel.com/docs/builds/configure-a-build
12. https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
13. https://vercel.com/kb/guide/connection-pooling-with-functions
14. https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute
15. https://vercel.com/marketplace/neon
16. https://vercel.com/templates/next.js/vercel-with-neon-postgres
17. https://nextjs.org/docs/app/guides/forms
18. https://nextjs.org/docs/app/guides/server-actions
19. https://nextjs.org/docs/app/guides/backend-for-frontend
20. https://nextjs.org/docs/app/guides/environment-variables
21. https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
22. https://neon.com/docs/introduction/plans
23. https://upstash.com/pricing
24. https://www.postgresql.org/docs/current/transaction-iso.html
25. https://www.postgresql.org/docs/current/sql-insert.html
26. https://www.postgresql.org/docs/current/explicit-locking.html

Web searches run (results used only to locate the pages above, not cited for facts): Vercel Postgres/Neon transition, Vercel KV/Upstash, Vercel migrations in build step, Neon serverless driver on Vercel.

**Attempted but blocked by the operator, hence UNVERIFIED:**
- https://neon.com/docs/connect/connection-pooling — pooled connection-string form, PgBouncer details, max connections
- https://neon.com/docs/serverless/serverless-driver — `@neondatabase/serverless` HTTP vs WebSocket, transaction support over HTTP
- a Neon free-plan limits search on `neon.com` / `neon.tech`

Doc versions observed at fetch time: **Next.js 16.3.1**; Vercel pages carrying `last_updated` between 2026-01-13 and 2026-08-03.
