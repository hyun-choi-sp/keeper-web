const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  queryTenant,
  getInstancePasswords,
  buildInstancesPlan,
  parseAwsEnv,
  listConnections,
  getKeeperApiUrl,
  getAuthToken,
  getGroupIdentifier,
} = require("../../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();
    const { targetName, environment, awsEnv } = req.body || {};
    if (!targetName) {
      return res.status(400).json({ error: "targetName is required." });
    }

    const credentials = awsEnv ? parseAwsEnv(awsEnv) : null;
    if (awsEnv && !credentials) {
      return res.status(400).json({ error: "Invalid AWS env format." });
    }

    const tenant = await queryTenant(targetName, environment, credentials);
    const instancePasswords = await getInstancePasswords(credentials);
    const existingConnections = await listConnections();
    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();

    const matchingEntries = Object.entries(existingConnections).filter(
      ([_, conn]) => conn?.name && conn.name.startsWith(`${targetName} - `)
    );

    const detailedConnections = await Promise.all(
      matchingEntries.map(([id, conn]) =>
        axios
          .get(`${apiUrl}/api/session/data/mysql/connections/${id}`, {
            headers: {
              "Content-Type": "application/json",
              "Guacamole-Token": authToken,
            },
          })
          .then((response) => ({ id, data: response.data, fallback: conn }))
          .catch(() => ({ id, data: null, fallback: conn }))
      )
    );

    const historyResults = await Promise.all(
      matchingEntries.map(([id]) =>
        axios
          .get(`${apiUrl}/api/session/data/mysql/connections/${id}/history`, {
            headers: {
              "Content-Type": "application/json",
              "Guacamole-Token": authToken,
            },
          })
          .then((response) => ({ id, data: response.data }))
          .catch(() => ({ id, data: [] }))
      )
    );

    const suggestedById = new Map(
      historyResults.map(({ id, data }) => {
        if (!Array.isArray(data) || data.length === 0) return [id, null];
        const latest = data.reduce((acc, item) => {
          if (!acc) return item;
          return (item.startDate || 0) > (acc.startDate || 0) ? item : acc;
        }, null);
        return [id, latest?.username || null];
      })
    );

    const existingByName = new Map(
      detailedConnections.map(({ id, data, fallback }) => {
        const connection = data || fallback;
        return [
          connection.name,
          {
            ...connection,
            identifier: id,
            suggestedUsername: suggestedById.get(id) || null,
          },
        ];
      })
    );
    const groupIdentifier = await getGroupIdentifier(targetName);
    const plan = buildInstancesPlan(
      tenant.instanceStack || {},
      instancePasswords,
      targetName,
      existingByName
    );

    res.json({
      tenant: {
        name: tenant.name,
        guid: tenant.GUID,
      },
      groupIdentifier,
      instances: plan,
    });
  } catch (error) {
    const status = error.status || error.response?.status || 500;
    const message = error.response?.data || error.message || "Unknown error";
    res.status(status).json({
      error: typeof message === "string" ? message : "Request failed.",
    });
  }
}
