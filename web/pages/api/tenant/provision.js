const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  queryTenant,
  getInstancePasswords,
  listConnections,
  ensureGroup,
  resolveInstanceConfig,
  buildConnectionParameters,
  updateDynamoDBRecord,
  getKeeperApiUrl,
  getAuthToken,
  parseAwsEnv,
} = require("../../../lib/keeper");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();
    const { targetName, environment, overrides, awsEnv } = req.body || {};
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
    const existingConnectionNames = new Set(
      Object.values(existingConnections).map((conn) => conn.name)
    );

    const instances = Object.entries(tenant.instanceStack || {});
    const keeperConnections = [];
    const errors = [];

    for (const [stackKey, instance] of instances) {
      if (instance.state === "terminated") continue;

      const { error, config } = resolveInstanceConfig({
        instance,
        stackKey,
        overrides,
        instancePasswords,
      });

      if (error) {
        errors.push({
          stackKey,
          displayName: instance.displayName,
          message: error,
        });
        continue;
      }

      const connectionName = `${targetName} - ${instance.displayName}`;
      if (existingConnectionNames.has(connectionName)) {
        continue;
      }

      const hostname = instance.publicIp || instance.publicDns || instance.publicIntDns;
      keeperConnections.push({
        name: connectionName,
        protocol: config.protocol,
        groupName: targetName,
        hostname,
        username: config.username,
        password: config.password,
      });
    }

    if (errors.length) {
      return res.status(400).json({ error: "Missing config.", details: errors });
    }

    const groupIdentifier = await ensureGroup(targetName);
    const apiUrl = getKeeperApiUrl();
    const authToken = getAuthToken();

    for (const connection of keeperConnections) {
      const parameters = buildConnectionParameters(connection.protocol, {
        hostname: connection.hostname,
        username: connection.username,
        password: connection.password,
      });

      await axios.post(
        `${apiUrl}/api/session/data/mysql/connections`,
        {
          parentIdentifier: groupIdentifier,
          name: connection.name,
          protocol: connection.protocol,
          parameters,
          attributes: {
            "max-connections": "",
            "max-connections-per-user": "",
            "guacd-hostname": "",
            "guacd-port": "",
            "guacd-encryption": "",
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Guacamole-Token": authToken,
          },
        }
      );
    }

    await updateDynamoDBRecord(tenant.GUID, environment, credentials);

    res.json({
      ok: true,
      addedConnections: keeperConnections.length,
      groupIdentifier,
    });
  } catch (error) {
    const status = error.status || error.response?.status || 500;
    const message = error.response?.data || error.message || "Unknown error";
    res.status(status).json({
      error: typeof message === "string" ? message : "Request failed.",
      details: typeof message === "string" ? undefined : message,
    });
  }
}
