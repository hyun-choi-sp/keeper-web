const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");
const {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  })
);

const secretsManagerClient = new SecretsManagerClient({ region: "us-east-1" });
let keeperAuthToken = null;
let keeperApiUrl = process.env.KEEPER_API_URL || "https://poc-access.sailpoint.com";
let keeperUsername = process.env.KEEPER_USERNAME || "";

function ensureAuthToken() {
  if (!keeperAuthToken) {
    const error = new Error("Not authenticated. Please log in.");
    error.status = 401;
    throw error;
  }
}

function getTableName(environment) {
  const env = environment || process.env.ENVIRONMENT || "production";
  return `DemoHub-Reservations-${env === "production" ? "prod" : "dev"}`;
}

async function getInstancePasswords() {
  const secretName = "instancePasswords";
  const secretCommand = new GetSecretValueCommand({ SecretId: secretName });
  const secretResponse = await secretsManagerClient.send(secretCommand);

  if (!secretResponse.SecretString) {
    throw new Error("SecretString is empty or undefined");
  }

  return JSON.parse(secretResponse.SecretString);
}

function buildInstancesPlan(instanceStack, instancePasswords) {
  const entries = Object.entries(instanceStack || {});

  return entries.map(([stackKey, instance]) => {
    const config = instancePasswords[instance.imageId] || null;
    const needsConfig = !config;
    const needsPassword = Boolean(config && config.username && !config.password);

    return {
      stackKey,
      displayName: instance.displayName,
      imageId: instance.imageId,
      state: instance.state,
      publicIp: instance.publicIp,
      publicDns: instance.publicDns,
      publicIntDns: instance.publicIntDns,
      protocol: config ? config.protocol : null,
      username: config ? config.username : null,
      needsConfig,
      needsPassword,
    };
  });
}

async function authenticateToKeeper({ username, password, apiUrl }) {
  const response = await axios.post(
    `${apiUrl}/api/tokens`,
    `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data.authToken;
}

async function listConnections() {
  const response = await axios.get(`${keeperApiUrl}/api/session/data/mysql/connections`, {
    headers: {
      "Content-Type": "application/json",
      "Guacamole-Token": keeperAuthToken,
    },
  });

  return response.data;
}

async function listConnectionGroups() {
  const response = await axios.get(`${keeperApiUrl}/api/session/data/mysql/connectionGroups`, {
    headers: {
      "Content-Type": "application/json",
      "Guacamole-Token": keeperAuthToken,
    },
  });

  return response.data;
}

async function ensureGroup(groupName) {
  const groups = await listConnectionGroups();
  const groupArray = Object.values(groups);
  const existing = groupArray.find((group) => group.name === groupName);

  if (existing) {
    return existing.identifier;
  }

  const groupResponse = await axios.post(
    `${keeperApiUrl}/api/session/data/mysql/connectionGroups`,
    {
      parentIdentifier: "ROOT",
      name: groupName,
      type: "ORGANIZATIONAL",
      attributes: {
        "max-connections": "",
        "max-connections-per-user": "",
        "enable-session-affinity": "",
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Guacamole-Token": keeperAuthToken,
      },
    }
  );

  return groupResponse.data.identifier;
}

async function getGroupIdentifier(groupName) {
  const groups = await listConnectionGroups();
  const groupArray = Object.values(groups);
  const existing = groupArray.find((group) => group.name === groupName);
  return existing ? existing.identifier : null;
}

function resolveOverride(overrides, stackKey, imageId) {
  if (!Array.isArray(overrides)) return null;

  return (
    overrides.find((item) => item.stackKey === stackKey) ||
    overrides.find((item) => item.imageId === imageId) ||
    null
  );
}

function resolveInstanceConfig({ instance, stackKey, overrides, instancePasswords }) {
  const baseConfig = instancePasswords[instance.imageId]
    ? { ...instancePasswords[instance.imageId] }
    : null;
  const override = resolveOverride(overrides, stackKey, instance.imageId);
  const config = { ...baseConfig, ...override };

  if (!config || !config.protocol || !config.username) {
    return { error: "Missing protocol or username.", config: null };
  }

  if (!config.password) {
    return { error: "Missing password.", config: null };
  }

  return { error: null, config };
}

function buildConnectionParameters(protocol, config) {
  if (protocol === "rdp") {
    return {
      hostname: config.hostname,
      username: config.username,
      password: config.password,
      port: "",
      security: "nla",
      "ignore-cert": "true",
    };
  }

  return {
    hostname: config.hostname,
    username: config.username,
    password: config.password,
    port: "22",
  };
}

async function updateDynamoDBRecord(guid, environment) {
  const tableName = getTableName(environment);
  const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });

  const params = {
    TableName: tableName,
    Key: {
      GUID: { S: guid },
    },
    UpdateExpression: "SET #attr = list_append(if_not_exists(#attr, :empty_list), :new_attr)",
    ExpressionAttributeNames: {
      "#attr": "attributes",
    },
    ExpressionAttributeValues: {
      ":new_attr": { L: [{ M: { name: { S: "KCM" }, value: { S: "yes" } } }] },
      ":empty_list": { L: [] },
    },
  };

  await dynamoDBClient.send(new UpdateItemCommand(params));
}

async function queryTenant(targetName, environment) {
  const tableName = getTableName(environment);
  const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });

  const params = {
    TableName: tableName,
    FilterExpression: "provisioningStatus = :status",
    ExpressionAttributeValues: { ":status": { S: "PROVISIONED" } },
  };

  let items = [];
  let lastEvaluatedKey = null;

  do {
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    const data = await dynamoDBClient.send(new ScanCommand(params));
    items = items.concat(data.Items.map((item) => unmarshall(item)));
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const tenant = items.find((item) => item.name === targetName);
  if (!tenant) {
    const error = new Error(`Tenant ${targetName} not found in DynamoDB.`);
    error.status = 404;
    throw error;
  }

  return tenant;
}

app.get("/api/config", (req, res) => {
  res.json({
    keeperApiUrl,
    keeperUsername,
    targetName: process.env.TARGET_NAME || "",
    environment: process.env.ENVIRONMENT || "production",
  });
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { keeperUsername: username, keeperPassword, keeperApiUrl: apiUrl } = req.body || {};

    if (!username || !keeperPassword) {
      return res.status(400).json({ error: "keeperUsername and keeperPassword are required." });
    }

    keeperApiUrl = apiUrl || keeperApiUrl;
    keeperUsername = username;

    keeperAuthToken = await authenticateToKeeper({
      username,
      password: keeperPassword,
      apiUrl: keeperApiUrl,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", (req, res) => {
  keeperAuthToken = null;
  res.json({ ok: true });
});

app.post("/api/tenant/preview", async (req, res, next) => {
  try {
    ensureAuthToken();
    const { targetName, environment } = req.body || {};
    if (!targetName) {
      return res.status(400).json({ error: "targetName is required." });
    }

    const tenant = await queryTenant(targetName, environment);
    const instancePasswords = await getInstancePasswords();
    const plan = buildInstancesPlan(tenant.instanceStack || {}, instancePasswords);

    res.json({
      tenant: {
        name: tenant.name,
        guid: tenant.GUID,
      },
      instances: plan,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tenant/provision", async (req, res, next) => {
  try {
    ensureAuthToken();
    const { targetName, environment, overrides } = req.body || {};
    if (!targetName) {
      return res.status(400).json({ error: "targetName is required." });
    }

    const tenant = await queryTenant(targetName, environment);
    const instancePasswords = await getInstancePasswords();
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

    for (const connection of keeperConnections) {
      const parameters = buildConnectionParameters(connection.protocol, {
        hostname: connection.hostname,
        username: connection.username,
        password: connection.password,
      });

      await axios.post(
        `${keeperApiUrl}/api/session/data/mysql/connections`,
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
            "Guacamole-Token": keeperAuthToken,
          },
        }
      );
    }

    await updateDynamoDBRecord(tenant.GUID, environment);

    res.json({
      ok: true,
      addedConnections: keeperConnections.length,
      groupIdentifier,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/add", async (req, res, next) => {
  try {
    ensureAuthToken();
    const { groupName, users } = req.body || {};
    if (!groupName || !Array.isArray(users)) {
      return res.status(400).json({ error: "groupName and users are required." });
    }

    const groupIdentifier = await getGroupIdentifier(groupName);
    if (!groupIdentifier) {
      return res.status(404).json({ error: `Group ${groupName} not found.` });
    }
    const connectionsResponse = await axios.get(
      `${keeperApiUrl}/api/session/data/mysql/connections`,
      {
        headers: {
          "Guacamole-Token": keeperAuthToken,
        },
      }
    );

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
        await axios.get(`${keeperApiUrl}/api/session/data/mysql/users/${userEmail}`, {
          headers: {
            "Guacamole-Token": keeperAuthToken,
          },
        });
      } catch (error) {
        if (error.response && error.response.status === 404) {
          await axios.post(
            `${keeperApiUrl}/api/session/data/mysql/users`,
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
                "Guacamole-Token": keeperAuthToken,
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
        `${keeperApiUrl}/api/session/data/mysql/users/${userEmail}/permissions`,
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
            "Guacamole-Token": keeperAuthToken,
          },
        }
      );

      if (groupConnections.length) {
        await Promise.all(
          groupConnections.map((connId) =>
            axios.patch(
              `${keeperApiUrl}/api/session/data/mysql/users/${userEmail}/permissions`,
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
                  "Guacamole-Token": keeperAuthToken,
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
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.status || error.response?.status || 500;
  const message = error.response?.data || error.message || "Unknown error";

  res.status(status).json({
    error: typeof message === "string" ? message : "Request failed.",
    details: typeof message === "string" ? undefined : message,
  });
});

app.listen(port, () => {
  console.log(`Keeper web server running on http://localhost:${port}`);
});
