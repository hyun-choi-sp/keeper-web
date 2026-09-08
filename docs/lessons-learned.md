# Lessons Learned

Non-obvious technical facts discovered while operating this tool. Add an entry when a
debugging session or investigation turns up something surprising, with the evidence that
established it.

---

## Template

```
## [Short title]

**Date:** YYYY-MM-DD
**Context:** What were we doing / what was the situation?
**What happened:** What went wrong or what did we discover?
**Root cause:** Why did it happen?
**Fix / Prevention:** What was changed or what should be done differently?
**Watch out for:** Any follow-on risks or related traps.
```

---

## The Reservations Table Cannot Be Searched By Tenant Name

**Date:** 2026-09-08
**Context:** Load Tenant took minutes. `queryTenant()` looked up a tenant by `name`.
**What happened:** `DemoHub-Reservations-prod` holds 23,883 items / 117 MB, and the lookup
was a full `Scan` that paged the entire table *before* matching on `name`. A standalone run
of the same scan did not finish within five minutes.
**Root cause:** The table's only key is `GUID`. Its four GSIs are on `provisioningStatus`,
`startDate`, `endDate` and `owner` — none on `name`. DynamoDB `Query` requires an equality
condition on a key, and `FilterExpression` is applied *after* the read, so it trims the
payload but not the work. PartiQL is the same engine underneath.
**Fix / Prevention:** Resolve the name through the DemoHub API instead (see ADR-001). Do not
"optimise" this with a filter or projection and expect it to get cheaper.
**Watch out for:** Only 2,474 of the 23,883 items are `PROVISIONED`, so even a query against
`provisioningStatus-index` still reads roughly 12 MB serially — measured at about 8 seconds
for a full pass. It is better than a scan and still not a lookup.

## DemoHub's Cognito Client Accepts a Loopback Callback and Has No Secret

**Date:** 2026-09-08
**Context:** Looking for a way to call the DemoHub API from a local tool without driving
Playwright, which is how the ServiceNow project authenticates.
**What happened:** The `DemoHub-WebUIClient` app client (user pool `DemoHub-AzureAD`, in
account 354769066836) has no client secret and already lists `http://localhost:4200/` among
its callback URLs. A local app can therefore run the full authorization-code + PKCE flow by
itself.
**Root cause:** The callback is registered for DemoHub's own Angular dev server. It is not
specific to us, but Cognito enforces the allowlist by value, not by who is using it.
**Fix / Prevention:** Verified rather than assumed: `authorize` with
`redirect_uri=http://localhost:4200/` returns 302 to Azure AD SAML, while an unregistered
port returns 302 to `error=redirect_mismatch`. `POST /oauth2/token` accepts a secretless
form body (HTTP 400 `invalid_grant` on a fake code, not 401).
**Watch out for:** This entry point exists at DemoHub's discretion. If their team drops the
localhost callback, sign-in breaks with `redirect_mismatch` and the app silently falls back
to scanning. Port 4200 must also be free while signing in.

## "Don't Re-implement the Code Exchange" Is Narrower Than It Sounds

**Date:** 2026-09-08
**Context:** `demohub_client.py` in the ServiceNow project warns not to re-implement the
OAuth2 code exchange, which read as "this is impossible outside a browser".
**What happened:** The warning applies to *reusing a code that DemoHub's own SPA already
consumed* — those codes are single-use, so a second exchange fails with `invalid_grant`.
Requesting our own code against a loopback redirect never enters that situation.
**Root cause:** The constraint is about code ownership, not about the flow being closed.
**Fix / Prevention:** Read constraints in existing code for their scope before treating them
as walls. This one distinction is what made the whole DemoHub sign-in possible.
**Watch out for:** The rest of that module's hard-won knowledge still applies — notably the
`role` header derived from the `custom:group` claim, and the `Origin`/`Referer` headers that
several endpoints require or else return 403.

## DemoHub Tokens Expire in About an Hour; the Refresh Token Lasts 30 Days

**Date:** 2026-09-08
**Context:** Trying to reuse `~/Projects/ServiceNow/src/auth_state.json` rather than logging
in again.
**What happened:** A file written at 11:00 the same day already failed `try_resume()` by the
evening. The saved cookies and id token were stale, so any plan that depends on "there is
probably a valid auth file" is unreliable.
**Root cause:** The Cognito id token is short-lived. The durable credential is the refresh
token, valid for 30 days, which `demohub_client.py` never reads — it harvests only
`idToken`/`accessToken` from local storage.
**Fix / Prevention:** Keep the refresh token from the token exchange and renew silently with
`grant_type=refresh_token`; a full browser sign-in is then a monthly event, not hourly.
**Watch out for:** A refresh token on disk is a 30-day credential at rest. This tool keeps
tokens in memory only (ADR-003), which costs one usually-silent click per server restart.

## The API and DynamoDB Agree on Everything Keeper Reads

**Date:** 2026-09-08
**Context:** Gate before wiring the DemoHub API into `queryTenant()`.
**What happened:** For the same tenant, `GET /reservations/?tenant=<name>` and a DynamoDB
`GetItem` on the resulting GUID returned identical `name`, `GUID` and `instanceStack`,
including every instance's `imageId`, `publicIp`, `displayName` and `state`. The app reads
only those three fields.
**Root cause:** The API is a view over the same table.
**Fix / Prevention:** The four fields the API omits — `jwt`,
`provisionStateMachineExecutionArn`, `threadId`, `type` — are unused here, but check this
again before making the API the source for any new field.
**Watch out for:** The list response uses `provisioningStatus`, not `status`. That means the
`reservation.get("status")` check inside `request_deprovision()` in the ServiceNow project's
`demohub_client.py` may never match, so its "already deprovisioning" branch is likely dead.
Observed on one `PROVISIONED` reservation queried with `?status=PROVISIONED`; worth
confirming on a `DEPROVISIONING` one before acting on it.

## AWS Credentials Never Needed Pasting

**Date:** 2026-09-08
**Context:** Step 2 asked for an `export AWS_*` block to be pasted in.
**What happened:** When the field is left empty, `credentials` is `null` and every client is
built with `credentials: undefined` — which is exactly how you ask the AWS SDK to use its
default chain. Setting `AWS_PROFILE` was always enough; no code change was required to make
SSO work.
**Root cause:** The paste field was written as the only path, not as an override.
**Fix / Prevention:** `web/.env.local` sets `AWS_PROFILE`, and the sign-in button runs
`aws sso login` for it. The paste field remains for borrowing another account's credentials.
**Watch out for:** Real environment variables win over `.env.local`. If a shell already
exports `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`, the dev server inherits those instead — check
with `env | grep AWS` when the wrong account shows up.

## Account and Identity Layout Around DemoHub

**Date:** 2026-09-08
**Context:** Mapping which credentials reach which resource.
**What happened:** Reservations, secrets and the Cognito user pool live in 354769066836,
while the tenant EC2 instances live in 820694137167 (`accountId` on each reservation).
Instance DNS follows `<role>.<tenant>.demohub.sailpointtechnologies.com`. Both AWS Identity
Center and DemoHub's Cognito federate to the same Azure AD tenant
(`9c848b2a-49ba-4c39-9749-118d06717a84`).
**Root cause:** DemoHub provisions tenant workloads into a separate account.
**Fix / Prevention:** Shared Azure AD is why two sign-ins feel like one — the browser
session carries over, so the second flow is normally silent.
**Watch out for:** Shared federation does **not** make the tokens interchangeable. AWS needs
SigV4 credentials, DemoHub needs a Cognito JWT; neither works in place of the other. Also
note the SE-Operations SSO role is *allowed* `dynamodb:UpdateTable` on the shared prod
reservations table — permission exists where ownership does not (ADR-002).
