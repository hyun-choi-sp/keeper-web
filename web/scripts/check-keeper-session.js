// Offline check for Keeper session detection.
// Usage: cd web && node scripts/check-keeper-session.js
const assert = require("assert");
const { parseCookies, keeperSessionUpdate } = require("../lib/keeper");

// The token has to survive cookie parsing, including a neighbouring cookie and a value that
// was URL-encoded on the way out.
const cookies = parseCookies("kcm_user=hyun.choi; kcm_token=ABC%3D123; kcm_api=https://x");
assert.strictEqual(cookies.kcm_token, "ABC=123");
assert.strictEqual(cookies.kcm_user, "hyun.choi");
assert.strictEqual(parseCookies("").kcm_token, undefined);
assert.strictEqual(parseCookies(undefined).kcm_token, undefined);

// No cookie means no session, whatever the server said.
const noCookie = keeperSessionUpdate(undefined, { authToken: "T1", username: "someone" });
assert.strictEqual(noCookie.signedIn, false);
assert.strictEqual(noCookie.token, null);

// Accepted and unchanged: signed in, and no need to rewrite the cookie.
const same = keeperSessionUpdate("T1", { authToken: "T1", username: "someone" });
assert.strictEqual(same.signedIn, true);
assert.strictEqual(same.username, "someone");
assert.strictEqual(same.refreshCookie, false);

// Accepted but rotated: the response wins and the cookie must be re-issued.
const rotated = keeperSessionUpdate("T1", { authToken: "T2", username: "someone" });
assert.strictEqual(rotated.signedIn, true);
assert.strictEqual(rotated.token, "T2");
assert.strictEqual(rotated.refreshCookie, true);

// Rejected (the route passes null after a 403): signed out, nothing to re-issue.
const rejected = keeperSessionUpdate("T1", null);
assert.strictEqual(rejected.signedIn, false);
assert.strictEqual(rejected.refreshCookie, false);

console.log("OK  keeper session helpers");
