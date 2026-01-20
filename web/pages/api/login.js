const {
  authenticateToKeeper,
  setAuthState,
} = require("../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { keeperUsername, keeperPassword, keeperApiUrl } = req.body || {};

    if (!keeperUsername || !keeperPassword) {
      return res
        .status(400)
        .json({ error: "keeperUsername and keeperPassword are required." });
    }

    const apiUrl =
      keeperApiUrl ||
      process.env.KEEPER_API_URL ||
      "https://poc-access.sailpoint.com";

    const token = await authenticateToKeeper({
      username: keeperUsername,
      password: keeperPassword,
      apiUrl,
    });

    setAuthState({
      token,
      apiUrl,
      username: keeperUsername,
    });

    res.setHeader("Set-Cookie", [
      `kcm_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
      `kcm_api=${encodeURIComponent(apiUrl)}; Path=/; SameSite=Lax`,
      `kcm_user=${encodeURIComponent(keeperUsername)}; Path=/; SameSite=Lax`,
    ]);

    res.json({ ok: true });
  } catch (error) {
    const status = error.status || error.response?.status || 500;
    const message = error.response?.data || error.message || "Unknown error";
    const details =
      typeof message === "string" ? message : JSON.stringify(message);

    console.error("Keeper login failed:", status, details);
    res.status(status).json({
      error: typeof message === "string" ? message : "Login failed.",
      details: typeof message === "string" ? undefined : message,
    });
  }
}
