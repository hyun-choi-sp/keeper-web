const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  getKeeperApiUrl,
  getAuthToken,
} = require("../../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();
    const { connectionId } = req.body || {};
    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required." });
    }

    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();

    await axios.delete(`${apiUrl}/api/session/data/mysql/connections/${connectionId}`, {
      headers: {
        "Content-Type": "application/json",
        "Guacamole-Token": authToken,
      },
    });

    res.json({ ok: true });
  } catch (error) {
    const status = error.status || error.response?.status || 500;
    const message = error.response?.data || error.message || "Unknown error";
    res.status(status).json({
      error: typeof message === "string" ? message : "Delete failed.",
      details: typeof message === "string" ? undefined : message,
    });
  }
}
