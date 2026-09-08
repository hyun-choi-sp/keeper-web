const {
  getConfigState,
  parseCookies,
  reauthenticateToKeeper,
  keeperSessionUpdate,
  setAuthState,
} = require("../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const config = getConfigState();
  const cookies = parseCookies(req.headers?.cookie);
  const cookieToken = cookies.kcm_token;
  const apiUrl = cookies.kcm_api || config.keeperApiUrl;

  if (!cookieToken) {
    return res.json({ ...config, signedIn: false });
  }

  // The token outlives the server process, so ask Keeper whether it is still good rather
  // than making the user retype a password for a session that is already valid.
  let update;
  try {
    update = keeperSessionUpdate(cookieToken, await reauthenticateToKeeper(cookieToken, apiUrl));
  } catch (error) {
    update = keeperSessionUpdate(cookieToken, null);
  }

  if (!update.signedIn) {
    res.setHeader("Set-Cookie", [
      "kcm_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax",
      "kcm_user=; Path=/; Max-Age=0; SameSite=Lax",
    ]);
    return res.json({ ...config, signedIn: false });
  }

  setAuthState({ token: update.token, apiUrl, username: update.username });

  if (update.refreshCookie) {
    res.setHeader("Set-Cookie", [
      `kcm_token=${encodeURIComponent(update.token)}; Path=/; HttpOnly; SameSite=Lax`,
    ]);
  }

  res.json({
    ...getConfigState(),
    keeperApiUrl: apiUrl,
    keeperUsername: update.username || config.keeperUsername,
    signedIn: true,
  });
}
