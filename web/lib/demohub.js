// DemoHub sign-in (Cognito hosted UI, authorization code + PKCE) and reservation lookup.
// The backend answers `GET /reservations/?tenant=<name>` server-side, which replaces the
// full DynamoDB scan the tenant lookup would otherwise need.
const crypto = require("crypto");
const http = require("http");
const { spawn } = require("child_process");
const axios = require("axios");

const authDomain = "https://auth.demohub.sailpointtechnologies.com";
const apiBase = "https://api-backend.prod.demohub.sailpointtechnologies.com";
const appOrigin = "https://demohub.sailpointtechnologies.com";
// DemoHub's own SPA client. It has no secret and already allows a loopback callback.
const clientId = "1423krarthjon466io5g1ofkqu";
const callbackPort = 4200;
const redirectUri = `http://localhost:${callbackPort}/`;
const loginTimeoutMs = 3 * 60 * 1000;
const requestTimeoutMs = 30 * 1000;
const refreshSkewMs = 60 * 1000;

// ponytail: tokens live in this process only, so a restart costs one (usually silent)
// click. Persisting the 30-day refresh token would need mode 0600 and a gitignore entry.
let session = null;

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function decodeClaims(idToken) {
  // Signature is not checked: the token came straight from Cognito over TLS and is only
  // read here for its expiry and group claim.
  const payload = idToken.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  } catch (error) {
    return {};
  }
}

function pickRole(claims) {
  const groups = String(claims["custom:group"] || "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);

  const readable = groups.filter((group) => group.startsWith("SSO - DemoHub - "));
  if (readable.includes("SSO - DemoHub - Admins")) return "SSO - DemoHub - Admins";
  return readable[0] || groups[0] || null;
}

function authorizeUrl(challenge, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  return `${authDomain}/oauth2/authorize?${params}`;
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (!code && !error) {
        res.writeHead(204).end(); // favicon and friends: keep waiting for the real hit
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><p>DemoHub sign-in complete. You can close this tab.</p></body></html>");
      server.close();
      clearTimeout(timer);

      if (error) return reject(new Error(`DemoHub returned "${error}".`));
      if (url.searchParams.get("state") !== expectedState) {
        return reject(new Error("Sign-in state mismatch; aborted."));
      }
      resolve(code);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the browser sign-in."));
    }, loginTimeoutMs);

    server.on("error", (error) => {
      clearTimeout(timer);
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`Port ${callbackPort} is in use; free it and sign in again.`)
          : error
      );
    });

    server.listen(callbackPort, "127.0.0.1");
  });
}

async function postToken(form) {
  const response = await axios.post(`${authDomain}/oauth2/token`, new URLSearchParams(form), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: requestTimeoutMs,
  });

  return response.data;
}

function storeTokens(tokens, fallbackRefreshToken) {
  const claims = decodeClaims(tokens.id_token);
  session = {
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token || fallbackRefreshToken || null,
    role: pickRole(claims),
    user: claims.email || claims["cognito:username"] || null,
    expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + 55 * 60 * 1000,
  };

  return session;
}

async function signIn() {
  const { verifier, challenge } = createPkce();
  const state = base64url(crypto.randomBytes(16));
  const pending = waitForCode(state);

  // ponytail: macOS-only browser launch, matching the rest of this tool.
  spawn("open", [authorizeUrl(challenge, state)], { detached: true, stdio: "ignore" }).unref();

  const code = await pending;
  const tokens = await postToken({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  return storeTokens(tokens);
}

async function getIdToken() {
  if (!session) return null;
  if (Date.now() < session.expiresAt - refreshSkewMs) return session.idToken;
  if (!session.refreshToken) {
    session = null;
    return null;
  }

  try {
    const tokens = await postToken({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: session.refreshToken,
    });
    return storeTokens(tokens, session.refreshToken).idToken;
  } catch (error) {
    session = null;
    return null;
  }
}

function sessionState() {
  return {
    signedIn: Boolean(session),
    user: session?.user || null,
    role: session?.role || null,
    expiration: session ? new Date(session.expiresAt).toISOString() : null,
  };
}

function normalizeReservation(reservation) {
  // The API calls it `status`; the rest of this app reads DynamoDB's `provisioningStatus`.
  return {
    ...reservation,
    provisioningStatus: reservation.provisioningStatus || reservation.status || null,
  };
}

async function findReservation(tenantName) {
  const idToken = await getIdToken();
  if (!idToken) return null;

  const response = await axios.get(`${apiBase}/reservations/`, {
    params: { tenant: tenantName, status: "PROVISIONED" },
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(session.role ? { role: session.role } : {}),
      // Several endpoints 403 without these even though /profile does not need them.
      Origin: appOrigin,
      Referer: `${appOrigin}/`,
      Accept: "application/json",
    },
    timeout: requestTimeoutMs,
  });

  const reservations = Array.isArray(response.data) ? response.data : [];
  // The server-side filter can be loose, so keep only an exact name match.
  const match = reservations.find((item) => (item?.name || "").trim() === tenantName);
  return match ? normalizeReservation(match) : null;
}

module.exports = {
  signIn,
  sessionState,
  findReservation,
  // exported for the offline check
  createPkce,
  pickRole,
  normalizeReservation,
  authorizeUrl,
  redirectUri,
};
