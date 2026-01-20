const { clearAuthState } = require("../../lib/keeper");

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  clearAuthState();
  res.setHeader("Set-Cookie", [
    "kcm_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax",
    "kcm_api=; Path=/; Max-Age=0; SameSite=Lax",
    "kcm_user=; Path=/; Max-Age=0; SameSite=Lax",
  ]);
  res.json({ ok: true });
}
