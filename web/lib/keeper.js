const axios = require("axios");
const {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { EC2Client, DescribeImagesCommand } = require("@aws-sdk/client-ec2");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { findReservation } = require("./demohub");

const defaultRegion = "us-east-1";

let keeperAuthToken = null;
let keeperApiUrl = process.env.KEEPER_API_URL || "https://poc-access.sailpoint.com";
let keeperUsername = process.env.KEEPER_USERNAME || "";

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce((acc, part) => {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) return acc;
    const value = valueParts.join("=");
    acc[key] = decodeURIComponent(value || "");
    return acc;
  }, {});
}

function loadAuthFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies.kcm_token;
  const apiUrl = cookies.kcm_api;
  const username = cookies.kcm_user;

  if (token) {
    keeperAuthToken = token;
  }

  if (apiUrl) {
    keeperApiUrl = apiUrl;
  }

  if (username) {
    keeperUsername = username;
  }
}

function ensureAuthToken() {
  if (!keeperAuthToken) {
    const error = new Error("Not authenticated. Please log in.");
    error.status = 401;
    throw error;
  }
}

function isProductionEnvironment(environment) {
  return (environment || process.env.ENVIRONMENT || "production") === "production";
}

function getTableName(environment) {
  return `DemoHub-Reservations-${isProductionEnvironment(environment) ? "prod" : "dev"}`;
}

async function getInstancePasswords(credentials) {
  const secretsManagerClient = buildSecretsManagerClient(credentials);
  const secretName = "instancePasswords";
  const secretCommand = new GetSecretValueCommand({ SecretId: secretName });
  const secretResponse = await secretsManagerClient.send(secretCommand);

  if (!secretResponse.SecretString) {
    throw new Error("SecretString is empty or undefined");
  }

  return JSON.parse(secretResponse.SecretString);
}

function extractUsername(parameters) {
  if (!parameters) return null;
  return (
    parameters.username ||
    parameters.user ||
    parameters["auth-username"] ||
    parameters["auth_user"] ||
    null
  );
}

function buildInstancesPlan(
  instanceStack,
  instancePasswords,
  targetName,
  existingByName,
  imageOsById = new Map()
) {
  const entries = Object.entries(instanceStack || {});

  return entries.map(([stackKey, instance]) => {
    const config = instancePasswords[instance.imageId] || null;
    const osLabel = imageOsById.get(instance.imageId) || null;
    const needsConfig = !config;
    const needsPassword = Boolean(config && config.username && !config.password);
    const connectionName = targetName
      ? `${targetName} - ${instance.displayName}`
      : null;
    const existing = connectionName ? existingByName?.get(connectionName) : null;
    const exists = Boolean(existing);

    return {
      stackKey,
      displayName: instance.displayName,
      imageId: instance.imageId,
      state: instance.state,
      publicIp: instance.publicIp,
      publicDns: instance.publicDns,
      publicIntDns: instance.publicIntDns,
      osLabel,
      protocol: config ? config.protocol : defaultProtocolForOs(osLabel),
      username: config ? config.username : null,
      needsConfig,
      needsPassword,
      connectionName,
      exists,
      existingProtocol: existing?.protocol || null,
      existingUsername: extractUsername(existing?.parameters),
      suggestedUsername: existing?.suggestedUsername || null,
      connectionId: existing?.identifier || null,
      sharingProfileExists: Boolean(existing?.sharingProfileExists),
      sharingProfileIdentifier: existing?.sharingProfileIdentifier || null,
      sharingProfileName: existing?.sharingProfileName || null,
      assignedUsers: existing?.assignedUsers || [],
    };
  });
}

function defaultProtocolForOs(osLabel) {
  if (osLabel === "Windows") return "rdp";
  if (osLabel === "Linux") return "ssh";
  return null;
}

function classifyImageOs(image) {
  if (!image) return null;

  const haystack = [
    image.Platform || "",
    image.PlatformDetails || "",
    image.Name || "",
    image.Description || "",
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("windows")) {
    return "Windows";
  }

  const linuxHints = [
    "linux",
    "unix",
    "ubuntu",
    "debian",
    "rhel",
    "red hat",
    "suse",
    "centos",
    "fedora",
    "rocky",
    "alma",
    "amzn",
    "amazon linux",
    "oracle linux",
  ];

  if (linuxHints.some((hint) => haystack.includes(hint))) {
    return "Linux";
  }

  return null;
}

async function getImageOsMap(instanceStack, credentials) {
  const imageIds = Array.from(
    new Set(
      Object.values(instanceStack || {})
        .map((instance) => instance?.imageId)
        .filter(Boolean)
    )
  );

  if (!imageIds.length) {
    return new Map();
  }

  const ec2Client = buildEc2Client(credentials);

  try {
    const response = await ec2Client.send(new DescribeImagesCommand({ ImageIds: imageIds }));
    const osByImageId = new Map();

    (response.Images || []).forEach((image) => {
      osByImageId.set(image.ImageId, classifyImageOs(image));
    });

    return osByImageId;
  } catch (error) {
    console.warn("Failed to resolve AMI platform details", error?.message || error);
    return new Map();
  }
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

function setAuthState({ token, apiUrl, username }) {
  keeperAuthToken = token;
  keeperApiUrl = apiUrl || keeperApiUrl;
  keeperUsername = username || keeperUsername;
}

function clearAuthState() {
  keeperAuthToken = null;
}

function getConfigState() {
  return {
    keeperApiUrl,
    keeperUsername,
    targetName: process.env.TARGET_NAME || "",
    environment: process.env.ENVIRONMENT || "production",
  };
}

function getAuthToken() {
  return keeperAuthToken;
}

function getKeeperApiUrl() {
  return keeperApiUrl;
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

async function listSharingProfiles() {
  const response = await axios.get(`${keeperApiUrl}/api/session/data/mysql/sharingProfiles`, {
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

async function updateDynamoDBRecord(guid, environment, credentials) {
  const tableName = getTableName(environment);
  const dynamoDBClient = buildDynamoDbClient(credentials);

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

async function queryTenant(targetName, environment, credentials) {
  const tableName = getTableName(environment);

  // The DemoHub API resolves the name server-side, which the table cannot do without an
  // index on `name`. It only serves production, and any miss falls through to the scan.
  if (isProductionEnvironment(environment)) {
    try {
      const reservation = await findReservation(targetName);
      if (reservation) return { ...reservation, lookupSource: "demohub" };
    } catch (error) {
      console.warn("DemoHub lookup failed, scanning DynamoDB instead", error?.message || error);
    }
  }

  const dynamoDBClient = buildDynamoDbClient(credentials);

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

  return { ...tenant, lookupSource: "table-scan" };
}

module.exports = {
  extractUsername,
  parseAwsEnv,
  loadAuthFromRequest,
  ensureAuthToken,
  getInstancePasswords,
  getImageOsMap,
  buildInstancesPlan,
  authenticateToKeeper,
  setAuthState,
  clearAuthState,
  getConfigState,
  getAuthToken,
  getKeeperApiUrl,
  listConnections,
  listSharingProfiles,
  ensureGroup,
  getGroupIdentifier,
  resolveInstanceConfig,
  buildConnectionParameters,
  updateDynamoDBRecord,
  queryTenant,
};
function parseAwsEnv(envText) {
  if (!envText || typeof envText !== "string") return null;

  const creds = {};
  const lines = envText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const exportLine = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed;
    const [key, ...rest] = exportLine.split("=");
    if (!key || rest.length === 0) continue;

    let value = rest.join("=").trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    creds[key.trim()] = value;
  }

  if (
    creds.AWS_ACCESS_KEY_ID &&
    creds.AWS_SECRET_ACCESS_KEY &&
    creds.AWS_SESSION_TOKEN
  ) {
    return {
      accessKeyId: creds.AWS_ACCESS_KEY_ID,
      secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
      sessionToken: creds.AWS_SESSION_TOKEN,
      region: creds.AWS_REGION || creds.AWS_DEFAULT_REGION || defaultRegion,
    };
  }

  return null;
}

// A fresh client re-resolves SSO credentials on its first call, which costs about 1.5s.
// Clients on the default chain are therefore reused; the SDK refreshes them when they
// expire. Pasted credentials stay per-call because they can differ between requests.
const defaultClients = {};

function reuseDefaultClient(key, create) {
  defaultClients[key] = defaultClients[key] || create();
  return defaultClients[key];
}

function explicitCredentials(credentials) {
  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  };
}

function buildSecretsManagerClient(credentials) {
  if (!credentials) {
    return reuseDefaultClient("secrets", () => new SecretsManagerClient({ region: defaultRegion }));
  }

  return new SecretsManagerClient({
    region: credentials.region || defaultRegion,
    credentials: explicitCredentials(credentials),
  });
}

function buildDynamoDbClient(credentials) {
  if (!credentials) {
    return reuseDefaultClient("dynamodb", () => new DynamoDBClient({ region: defaultRegion }));
  }

  return new DynamoDBClient({
    region: credentials.region || defaultRegion,
    credentials: explicitCredentials(credentials),
  });
}

function buildEc2Client(credentials) {
  if (!credentials) {
    return reuseDefaultClient("ec2", () => new EC2Client({ region: defaultRegion }));
  }

  return new EC2Client({
    region: credentials.region || defaultRegion,
    credentials: explicitCredentials(credentials),
  });
}
