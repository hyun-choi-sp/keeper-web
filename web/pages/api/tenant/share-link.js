const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  getKeeperApiUrl,
  getAuthToken,
} = require("../../../lib/keeper");

const DEFAULT_TUNNEL_TIMEOUT_MS = 8000;
const DEFAULT_CONNECT_TIMEOUT_MS = 12000;

function pickActiveConnection(activeConnections, connectionId) {
  if (!activeConnections || !connectionId) return null;
  const entries = Object.entries(activeConnections).map(([id, value]) => ({
    id,
    ...value,
  }));
  const matches = entries.filter(
    (entry) => entry.connectionIdentifier === connectionId
  );
  if (!matches.length) return null;
  return matches.reduce((latest, entry) => {
    if (!latest) return entry;
    return (entry.startDate || 0) > (latest.startDate || 0) ? entry : latest;
  }, null);
}

async function fetchActiveConnection(apiUrl, authToken, connectionId) {
  const headers = {
    "Content-Type": "application/json",
    "Guacamole-Token": authToken,
  };

  const primary = await axios
    .get(`${apiUrl}/api/session/data/mysql/activeConnections`, { headers })
    .then((response) => response.data)
    .catch(() => null);

  let match = pickActiveConnection(primary, connectionId);
  if (match) return match;

  const secondary = await axios
    .get(`${apiUrl}/api/session/data/mysql-shared/activeConnections`, { headers })
    .then((response) => response.data)
    .catch(() => null);

  match = pickActiveConnection(secondary, connectionId);
  return match;
}

function extractTunnelId(payload) {
  if (typeof payload !== "string") return null;
  const match = payload.match(/0\.,\d+\.([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

function buildWebSocketUrl(apiUrl, authToken, connectionId) {
  const baseUrl = apiUrl.replace(/\/$/, "");
  const wsBase = baseUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const params = new URLSearchParams({
    token: authToken,
    GUAC_DATA_SOURCE: "mysql",
    GUAC_ID: connectionId,
    GUAC_TYPE: "c",
    GUAC_WIDTH: "1920",
    GUAC_HEIGHT: "1080",
    GUAC_DPI: "96",
    GUAC_TIMEZONE: timeZone,
  });
  params.append("GUAC_AUDIO", "audio/L8");
  params.append("GUAC_AUDIO", "audio/L16");
  params.append("GUAC_IMAGE", "image/jpeg");
  params.append("GUAC_IMAGE", "image/png");
  params.append("GUAC_IMAGE", "image/webp");
  return `${wsBase}/websocket-tunnel?${params.toString()}`;
}

async function openTunnel(apiUrl, authToken, connectionId) {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket not available in server runtime.");
  }

  return new Promise((resolve, reject) => {
    const url = buildWebSocketUrl(apiUrl, authToken, connectionId);
    const ws = new WebSocket(url, "guacamole");
    let resolved = false;

    const connectTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.close();
      reject(new Error("Timed out starting tunnel."));
    }, DEFAULT_CONNECT_TIMEOUT_MS);

    const tunnelTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.close();
      reject(new Error("Timed out waiting for tunnel id."));
    }, DEFAULT_TUNNEL_TIMEOUT_MS);

    ws.onopen = () => {
      // Keep tunnel open long enough to request sharing credentials.
    };

    ws.onmessage = (event) => {
      const tunnelId = extractTunnelId(event.data);
      if (!tunnelId || resolved) return;
      resolved = true;
      clearTimeout(connectTimer);
      clearTimeout(tunnelTimer);
      resolve({ tunnelId, ws });
    };

    ws.onerror = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(connectTimer);
      clearTimeout(tunnelTimer);
      try {
        ws.close();
      } catch (err) {
        // ignore close errors
      }
      reject(new Error("Failed to open tunnel."));
    };

    ws.onclose = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(connectTimer);
      clearTimeout(tunnelTimer);
      reject(new Error("Tunnel closed before initialization."));
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();
    const { connectionId, sharingProfileId, sharingProfileName, connectionName } =
      req.body || {};
    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required." });
    }

    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();
    const headers = {
      "Content-Type": "application/json",
      "Guacamole-Token": authToken,
    };

    let resolvedProfileId = sharingProfileId;
    if (!resolvedProfileId) {
      const createResponse = await axios.post(
        `${apiUrl}/api/session/data/mysql/sharingProfiles`,
        {
          primaryConnectionIdentifier: connectionId,
          name: sharingProfileName || connectionName || "Shared connection",
          parameters: { "read-only": "" },
          attributes: {},
        },
        { headers }
      );
      resolvedProfileId = createResponse?.data?.identifier || null;
    }

    if (!resolvedProfileId) {
      return res.status(500).json({ error: "Sharing profile unavailable." });
    }

    let activeId = null;
    let tunnelSocket = null;
    const activeConnection = await fetchActiveConnection(
      apiUrl,
      authToken,
      connectionId
    );
    if (activeConnection) {
      activeId = activeConnection.identifier || activeConnection.id;
    } else {
      const tunnelResult = await openTunnel(apiUrl, authToken, connectionId);
      activeId = tunnelResult.tunnelId;
      tunnelSocket = tunnelResult.ws;
    }

    if (!activeId) {
      return res.status(500).json({ error: "Active connection not found." });
    }

    const credentialsResponse = await axios.get(
      `${apiUrl}/api/session/tunnels/${activeId}/activeConnection/sharingCredentials/${resolvedProfileId}`,
      { headers }
    );
    const key = credentialsResponse?.data?.values?.key;
    if (!key) {
      return res.status(500).json({ error: "Sharing key unavailable." });
    }

    const baseUrl = apiUrl.replace(/\/$/, "");
    const link = `${baseUrl}/#/?key=${encodeURIComponent(key)}`;
    if (tunnelSocket) {
      setTimeout(() => {
        try {
          tunnelSocket.close();
        } catch (err) {
          // ignore close errors
        }
      }, 1000);
    }

    return res.json({ link, key, sharingProfileId: resolvedProfileId });
  } catch (error) {
    const status = error.status || error.response?.status || 500;
    const message = error.response?.data || error.message || "Unknown error";
    return res
      .status(status)
      .json({ error: typeof message === "string" ? message : "Request failed." });
  }
}
