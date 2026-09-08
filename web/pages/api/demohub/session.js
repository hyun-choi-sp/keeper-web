const { loadAuthFromRequest, ensureAuthToken } = require("../../../lib/keeper");
const { signIn, sessionState } = require("../../../lib/demohub");

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.json(sessionState());
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();

    await signIn();
    res.json(sessionState());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}
