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

console.log("OK  demohub helpers");
