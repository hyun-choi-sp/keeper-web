const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  queryTenant,
  getInstancePasswords,
  buildInstancesPlan,
  parseAwsEnv,
  listConnections,
  listSharingProfiles,
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
    const sharingProfilesResponse = await listSharingProfiles();
    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();
    const headers = {
      "Content-Type": "application/json",
      "Guacamole-Token": authToken,
    };

    const matchingEntries = Object.entries(existingConnections).filter(
      ([_, conn]) => conn?.name && conn.name.startsWith(`${targetName} - `)
    );

    const detailedConnections = await Promise.all(
      matchingEntries.map(([id, conn]) =>
        axios
          .get(`${apiUrl}/api/session/data/mysql/connections/${id}`, { headers })
          .then((response) => ({ id, data: response.data, fallback: conn }))
          .catch(() => ({ id, data: null, fallback: conn }))
      )
    );

    const historyResults = await Promise.all(
      matchingEntries.map(([id]) =>
        axios
          .get(`${apiUrl}/api/session/data/mysql/connections/${id}/history`, { headers })
          .then((response) => ({ id, data: response.data }))
          .catch(() => ({ id, data: [] }))
      )
    );

    const permissionResults = await Promise.all(
      matchingEntries.map(([id]) =>
        axios
          .get(`${apiUrl}/api/session/data/mysql/connections/${id}/permissions`, {
            headers,
          })
          .then((response) => ({ id, data: response.data }))
          .catch(() => ({ id, data: null }))
      )
    );

    const extractUsers = (permissions) => {
      if (!permissions || typeof permissions !== "object") return [];
      const candidates = [];
      if (permissions.userPermissions && typeof permissions.userPermissions === "object") {
        candidates.push(permissions.userPermissions);
      }
      if (permissions.users && typeof permissions.users === "object") {
        candidates.push(permissions.users);
      }
      if (!candidates.length) {
        candidates.push(permissions);
      }

      const ignoreKeys = new Set([
        "connectionPermissions",
        "connectionGroupPermissions",
        "systemPermissions",
        "userPermissions",
        "activeConnectionPermissions",
      ]);
      const users = new Set();

      candidates.forEach((bucket) => {
        Object.entries(bucket).forEach(([key, value]) => {
          if (ignoreKeys.has(key)) return;
          if (!value) return;
          if (Array.isArray(value)) {
            if (value.length > 0) users.add(key);
            return;
          }
          if (typeof value === "string") {
            if (value) users.add(key);
            return;
          }
          if (typeof value === "object") {
            if (value.READ || value.read || value.UPDATE || value.update || value.ADMIN) {
              users.add(key);
            }
          }
        });
      });

      return Array.from(users);
    };

    const connectionUsersById = new Map(
      permissionResults.map(({ id, data }) => [id, extractUsers(data)])
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

    const profilesList = Array.isArray(sharingProfilesResponse)
      ? sharingProfilesResponse
      : sharingProfilesResponse?.sharingProfiles && Array.isArray(sharingProfilesResponse.sharingProfiles)
      ? sharingProfilesResponse.sharingProfiles
      : sharingProfilesResponse && typeof sharingProfilesResponse === "object"
      ? Object.values(sharingProfilesResponse)
      : [];

    const sharingProfileByConnection = new Map(
      profilesList
        .filter((profile) => profile?.primaryConnectionIdentifier)
        .map((profile) => [profile.primaryConnectionIdentifier, profile])
    );

    const existingByName = new Map(
      detailedConnections.map(({ id, data, fallback }) => {
        const connection = data || fallback;
        const profile = sharingProfileByConnection.get(id) || null;
        return [
          connection.name,
          {
            ...connection,
            identifier: id,
            suggestedUsername: suggestedById.get(id) || null,
            sharingProfileExists: Boolean(profile),
            sharingProfileIdentifier: profile?.identifier || null,
            sharingProfileName: profile?.name || null,
            assignedUsers: connectionUsersById.get(id) || [],
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
