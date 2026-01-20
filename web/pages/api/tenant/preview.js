const {
  loadAuthFromRequest,
  ensureAuthToken,
  queryTenant,
  getInstancePasswords,
  buildInstancesPlan,
  parseAwsEnv,
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
    const plan = buildInstancesPlan(tenant.instanceStack || {}, instancePasswords);

    res.json({
      tenant: {
        name: tenant.name,
        guid: tenant.GUID,
      },
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
