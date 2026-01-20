const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  getGroupIdentifier,
  getKeeperApiUrl,
  getAuthToken,
} = require("../../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();
    const { groupName, users } = req.body || {};
    if (!groupName || !Array.isArray(users)) {
      return res.status(400).json({ error: "groupName and users are required." });
    }

    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();
    const groupIdentifier = await getGroupIdentifier(groupName);

    if (!groupIdentifier) {
      return res.status(404).json({ error: `Group ${groupName} not found.` });
    }

    const connectionsResponse = await axios.get(`${apiUrl}/api/session/data/mysql/connections`, {
      headers: {
        "Guacamole-Token": authToken,
      },
    });

    const groupConnections = Object.entries(connectionsResponse.data)
      .filter(([_, conn]) => conn.parentIdentifier === groupIdentifier)
      .map(([id]) => id);

    const results = [];

    for (const userEmail of users) {
      if (!userEmail) continue;
      let fullName = userEmail;
      let organization = "";

      const emailParts = userEmail.split("@");
      if (emailParts.length === 2) {
        organization = emailParts[1].split(".")[0];

        const namePart = emailParts[0];
        if (namePart.includes(".")) {
          fullName = namePart
            .split(".")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(" ");
        }
      }

      let userCreated = false;

      try {
        await axios.get(`${apiUrl}/api/session/data/mysql/users/${userEmail}`, {
          headers: {
            "Guacamole-Token": authToken,
          },
        });
      } catch (error) {
        if (error.response && error.response.status === 404) {
          await axios.post(
            `${apiUrl}/api/session/data/mysql/users`,
            {
              username: userEmail,
              password: "Sailp0!nt",
              attributes: {
                expired: "true",
                disabled: "",
                "guac-email-address": userEmail,
                "guac-full-name": fullName,
                "guac-organization": organization,
              },
            },
            {
              headers: {
                "Content-Type": "application/json",
                "Guacamole-Token": authToken,
              },
            }
          );
          userCreated = true;
        } else {
          results.push({ email: userEmail, status: "error", error: error.message });
          continue;
        }
      }

      await axios.patch(
        `${apiUrl}/api/session/data/mysql/users/${userEmail}/permissions`,
        [
          {
            op: "add",
            path: `/connectionGroupPermissions/${groupIdentifier}`,
            value: "READ",
          },
          {
            op: "add",
            path: `/userPermissions/${userEmail}`,
            value: "UPDATE",
          },
        ],
        {
          headers: {
            "Content-Type": "application/json",
            "Guacamole-Token": authToken,
          },
        }
      );

      if (groupConnections.length) {
        await Promise.all(
          groupConnections.map((connId) =>
            axios.patch(
              `${apiUrl}/api/session/data/mysql/users/${userEmail}/permissions`,
              [
                {
                  op: "add",
                  path: `/connectionPermissions/${connId}`,
                  value: "READ",
                },
              ],
              {
                headers: {
                  "Content-Type": "application/json",
                  "Guacamole-Token": authToken,
                },
              }
            )
          )
        );
      }

      results.push({ email: userEmail, status: "ok", created: userCreated });
    }

    res.json({ ok: true, results, connections: groupConnections.length });
  } catch (error) {
    const status = error.status || error.response?.status || 500;
    const message = error.response?.data || error.message || "Unknown error";
    res.status(status).json({
      error: typeof message === "string" ? message : "Request failed.",
      details: typeof message === "string" ? undefined : message,
    });
  }
}
