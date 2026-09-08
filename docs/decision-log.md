# Decision Log

Architecture decisions visible in the current codebase, recorded for future reference.

---

## ADR-001: DemoHub API for Tenant Lookup, AWS SDK for Everything Else

**Date:** 2026-09-08
**Decision:** `queryTenant()` resolves a tenant name through
`GET /reservations/?tenant=<name>` on DemoHub's backend. Instance passwords (Secrets
Manager), AMI platform detection (EC2) and the post-provision KCM flag (DynamoDB write)
continue to go through the AWS SDK.
**Reason:** The reservations table cannot answer "which reservation is named X" without
reading everything (see lessons-learned). DemoHub's backend answers it server-side in one
call — measured at about 3 seconds against minutes for the scan. The other three operations
have no equivalent API and are writes or non-reservation data.
**Consequence:** Both sign-ins are needed for the full workflow; DemoHub alone is not enough
to run the tool. The scan remains in the code as the fallback path and must not be deleted.
**Related Files:** `web/lib/demohub.js`, `web/lib/keeper.js`

## ADR-002: Do Not Add an Index to the Shared Reservations Table

**Date:** 2026-09-08
**Decision:** No `name` GSI is created on `DemoHub-Reservations-prod` or `-dev`.
**Reason:** A `KEYS_ONLY` GSI on `name` would give constant-time lookups using only the AWS
credentials this app already holds, and the SE-Operations role does have
`dynamodb:UpdateTable` there. But the table belongs to the DemoHub team, and every write to
it would carry an extra index write from then on. Having the permission is not the same as
owning the table.
**Consequence:** The lookup problem is solved on the client side instead, through the API.
If DemoHub ever adds a `name` index themselves, `queryTenant()` can drop to a two-call
`Query` + `GetItem` and the DemoHub sign-in becomes optional.
**Related Files:** `web/lib/keeper.js`, `docs/plans/2026-09-08-demohub-sso-tenant-lookup.md`

## ADR-003: DemoHub Tokens Live in Memory Only — superseded by ADR-007

**Date:** 2026-09-08
**Decision:** The id token and the 30-day refresh token are held in a module-level variable
in the Next.js server process and are never written to disk.
**Reason:** Persisting the refresh token would survive restarts, but it is a 30-day
credential; a file on a laptop is a larger exposure than one browser click. The Azure AD
session usually makes that click silent.
**Consequence:** Restarting the dev server signs the user out of DemoHub. Tenant lookup
falls back to the scan until they sign in again, which is slow but correct. If this is ever
persisted, it needs mode 0600 and a gitignore entry.
**Related Files:** `web/lib/demohub.js`

## ADR-004: One Sign-in Button, Two Independent Flows

**Date:** 2026-09-08
**Decision:** The Step 2 button runs the AWS flow and then the DemoHub flow, with a separate
API route and status pill for each. AWS failing stops the sequence; DemoHub failing only
warns.
**Reason:** A single credential for both is impossible — AWS needs SigV4 keys and DemoHub
needs a Cognito JWT. Shared Azure AD federation is what makes two flows feel like one. AWS
is required to use the app at all, while DemoHub only makes the lookup fast, so their
failures are not equally serious.
**Consequence:** Each route stays independently testable and independently revocable. A
combined "sign in to everything" endpoint was deliberately not built.
**Related Files:** `web/pages/api/aws/session.js`, `web/pages/api/demohub/session.js`,
`web/pages/index.js`

## ADR-005: The DemoHub Path Is Production-Only

**Date:** 2026-09-08
**Decision:** `queryTenant()` consults DemoHub only when the environment resolves to
production; the Development setting always uses the DynamoDB scan against
`DemoHub-Reservations-dev`.
**Reason:** `api-backend.prod.demohub.sailpointtechnologies.com` serves production
reservations. Without the gate, a dev tenant would be looked up in the wrong dataset and
come back as a confusing 404.
**Consequence:** Development mode keeps the old latency. That is acceptable — it is the
rarer path, and correctness matters more than speed here.
**Related Files:** `web/lib/keeper.js`

## ADR-006: Sign-in Routes Require an Active Keeper Session

**Date:** 2026-09-08
**Decision:** `POST` on both session routes calls `ensureAuthToken()` first; `GET` (status
only) stays open.
**Reason:** These routes spawn a CLI and open browser windows on the developer's machine.
Any page the developer visits could otherwise `POST` to `localhost:3000` and trigger a
sign-in prompt.
**Consequence:** Sign-in is only available after Step 1, which matches how the rest of the
app already behaves.
**Related Files:** `web/pages/api/aws/session.js`, `web/pages/api/demohub/session.js`

## ADR-007: Persist the DemoHub Refresh Token Outside the Repo

**Date:** 2026-09-08
**Decision:** Supersedes ADR-003. The refresh token and its horizon are written to
`~/.keeper/demohub.json` with mode 0600 (directory 0700). The id token is never written.
`KEEPER_DEMOHUB_AUTH_FILE` overrides the path, which the offline check uses so it cannot
clobber a real session.
**Reason:** Memory-only meant every dev-server restart silently dropped the session and the
tenant lookup quietly fell back to the table scan. That is the asymmetry against AWS, which
reports "Ready" after a restart precisely because the AWS CLI caches its SSO token on disk.
This stores the same kind of credential the same machine already keeps.
**Consequence:** A 30-day credential now exists at rest. It is deleted automatically when a
refresh fails, and it lives outside the repository so it cannot be committed by accident.
Signing in becomes a monthly event rather than a per-restart one.
**Related Files:** `web/lib/demohub.js`, `web/scripts/check-demohub-lookup.js`
