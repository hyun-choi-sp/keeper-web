// Offline check for the DemoHub sign-in and lookup helpers.
// Usage: cd web && node scripts/check-demohub-lookup.js
const assert = require("assert");
const crypto = require("crypto");
const {
  createPkce,
  pickRole,
  normalizeReservation,
  authorizeUrl,
  redirectUri,
  storeTokens,
  sessionState,
} = require("../lib/demohub");

// PKCE: the challenge must be the S256 digest of the verifier (RFC 7636 test vector).
const knownVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const knownChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const derived = crypto
  .createHash("sha256")
  .update(knownVerifier)
  .digest("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
assert.strictEqual(derived, knownChallenge, "S256 derivation is wrong");

const pkce = createPkce();
assert.ok(pkce.verifier.length >= 43, "verifier is too short for RFC 7636");
assert.ok(!/[+/=]/.test(pkce.challenge), "challenge must be base64url");
assert.notStrictEqual(createPkce().verifier, pkce.verifier, "verifier must not repeat");

// The authorize URL must ask for a code against the registered loopback callback.
const url = new URL(authorizeUrl(pkce.challenge, "state-123"));
assert.strictEqual(url.searchParams.get("redirect_uri"), redirectUri);
assert.strictEqual(url.searchParams.get("response_type"), "code");
assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
assert.strictEqual(url.searchParams.get("state"), "state-123");

// Role header: Admins wins, then any readable DemoHub group, then whatever is there.
assert.strictEqual(
  pickRole({ "custom:group": "[SSO - DemoHub - Users, SSO - DemoHub - Admins]" }),
  "SSO - DemoHub - Admins"
);
assert.strictEqual(
  pickRole({ "custom:group": "[SSO - Other - Thing, SSO - DemoHub - Users]" }),
  "SSO - DemoHub - Users"
);
assert.strictEqual(pickRole({}), null);

// The API reports `status`; the rest of the app reads `provisioningStatus`.
assert.strictEqual(
  normalizeReservation({ name: "t", status: "PROVISIONED" }).provisioningStatus,
  "PROVISIONED"
);
assert.strictEqual(
  normalizeReservation({ name: "t", provisioningStatus: "PROVISIONED" }).provisioningStatus,
  "PROVISIONED"
);

// Exact-name matching: a fuzzy server-side filter must not hand back a neighbour.
const exactMatch = (list, name) => list.find((item) => (item?.name || "").trim() === name);
const reservations = [{ name: "company23118-poc" }, { name: "company231" }];
assert.strictEqual(exactMatch(reservations, "company231").name, "company231");
assert.strictEqual(exactMatch(reservations, "company2311"), undefined);

// A refresh must not shorten the session: Cognito returns no new refresh token, so the
// original one and the 30-day horizon have to survive, and the reported expiry is that
// horizon rather than the hour-long id token.
const fakeIdToken = (claims) =>
  `header.${Buffer.from(JSON.stringify(claims))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}.signature`;
const anHourOut = Math.floor(Date.now() / 1000) + 3600;

const first = storeTokens({
  id_token: fakeIdToken({ exp: anHourOut, email: "someone@example.com" }),
  refresh_token: "refresh-token-1",
});
assert.ok(
  first.sessionExpiresAt - Date.now() > 29 * 24 * 60 * 60 * 1000,
  "a fresh sign-in should report the 30-day refresh token, not the id token"
);

// A session that started 25 days ago must keep its own horizon, not gain a new 30 days.
const started25DaysAgo = {
  refreshToken: "refresh-token-1",
  sessionExpiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
};
const afterRefresh = storeTokens(
  { id_token: fakeIdToken({ exp: anHourOut + 3600, email: "someone@example.com" }) },
  started25DaysAgo
);

assert.strictEqual(afterRefresh.refreshToken, "refresh-token-1", "refresh token was dropped");
assert.strictEqual(
  afterRefresh.sessionExpiresAt,
  started25DaysAgo.sessionExpiresAt,
  "refreshing must not move the session horizon"
);

sessionState().then((state) => {
  assert.strictEqual(state.signedIn, true);
  assert.strictEqual(state.expiration, new Date(started25DaysAgo.sessionExpiresAt).toISOString());
  console.log("OK  demohub helpers");
});
