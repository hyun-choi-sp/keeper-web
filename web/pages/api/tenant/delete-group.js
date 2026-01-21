const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  getKeeperApiUrl,
  getAuthToken,
  getGroupIdentifier,
} = require("../../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();
    const { groupName, groupIdentifier } = req.body || {};
    if (!groupName && !groupIdentifier) {
      return res.status(400).json({ error: "groupName or groupIdentifier is required." });
    }

    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();
    const identifier = groupIdentifier || (await getGroupIdentifier(groupName));

    if (!identifier) {
      return res.status(404).json({ error: "Group not found." });
    }

    await axios.delete(
      `${apiUrl}/api/session/data/mysql/connectionGroups/${identifier}`,
      {
        headers: {
          "Content-Type": "application/json",
          "Guacamole-Token": authToken,
        },
      }
    );

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
