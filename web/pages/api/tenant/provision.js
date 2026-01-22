const axios = require("axios");
const {
  loadAuthFromRequest,
  ensureAuthToken,
  queryTenant,
  getInstancePasswords,
  listConnections,
  listSharingProfiles,
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
    const sharingProfilesResponse = await listSharingProfiles();
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
      Object.entries(existingConnections).map(([id, conn]) => [
        conn.name,
        { ...conn, identifier: id },
      ])
    );
    const overrideByStackKey = new Map(
      (overrides || []).map((item) => [item.stackKey, item])
    );

    const instances = Object.entries(tenant.instanceStack || {});
    const keeperConnections = [];
    const updateConnections = [];
    const errors = [];

    for (const [stackKey, instance] of instances) {
      if (instance.state === "terminated") continue;

      const baseConfig = instancePasswords[instance.imageId] || null;
      const needsConfig = !baseConfig;
      const needsPassword = Boolean(baseConfig && baseConfig.username && !baseConfig.password);
      const connectionName = `${targetName} - ${instance.displayName}`;
      const existingConnection = existingByName.get(connectionName);
      const override = overrideByStackKey.get(stackKey);

      if (existingConnection) {
        if (!override || !override.updateExisting) {
          continue;
        }

        const parameters = { ...(existingConnection.parameters || {}) };
        const protocol = override.protocol || existingConnection.protocol;

        if (override.username) {
          parameters.username = override.username;
        }
        if (override.password) {
          parameters.password = override.password;
        }

        if (!parameters.password) {
          errors.push({
            stackKey,
            displayName: instance.displayName,
            message: "Password required to update existing connection.",
          });
          continue;
        }

        updateConnections.push({
          identifier: existingConnection.identifier,
          parentIdentifier: existingConnection.parentIdentifier,
          name: connectionName,
          protocol,
          parameters: buildConnectionParameters(protocol, parameters),
          attributes: existingConnection.attributes || {
            "max-connections": "",
            "max-connections-per-user": "",
            "guacd-hostname": "",
            "guacd-port": "",
            "guacd-encryption": "",
          },
        });
        continue;
      }

      if (!override && (needsConfig || needsPassword)) {
        continue;
      }

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
    if (!keeperConnections.length && !updateConnections.length) {
      return res.status(400).json({ error: "No changes to apply." });
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

      const connectionResponse = await axios.post(
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

      const createdId = connectionResponse?.data?.identifier;
      if (createdId && !sharingProfileByConnection.has(createdId)) {
        await axios.post(
          `${apiUrl}/api/session/data/mysql/sharingProfiles`,
          {
            primaryConnectionIdentifier: createdId,
            name: connection.name,
            parameters: { "read-only": "" },
            attributes: {},
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Guacamole-Token": authToken,
            },
          }
        );
        sharingProfileByConnection.set(createdId, { identifier: createdId, name: connection.name });
      }
    }

    for (const connection of updateConnections) {
      await axios.put(
        `${apiUrl}/api/session/data/mysql/connections/${connection.identifier}`,
        {
          parentIdentifier: connection.parentIdentifier,
          name: connection.name,
          protocol: connection.protocol,
          parameters: connection.parameters,
          attributes: connection.attributes,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Guacamole-Token": authToken,
          },
        }
      );

      if (!sharingProfileByConnection.has(connection.identifier)) {
        await axios.post(
          `${apiUrl}/api/session/data/mysql/sharingProfiles`,
          {
            primaryConnectionIdentifier: connection.identifier,
            name: connection.name,
            parameters: { "read-only": "" },
            attributes: {},
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Guacamole-Token": authToken,
            },
          }
        );
        sharingProfileByConnection.set(connection.identifier, {
          identifier: connection.identifier,
          name: connection.name,
        });
      }
    }

    await updateDynamoDBRecord(tenant.GUID, environment, credentials);

    res.json({
      ok: true,
      addedConnections: keeperConnections.length,
      updatedConnections: updateConnections.length,
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
