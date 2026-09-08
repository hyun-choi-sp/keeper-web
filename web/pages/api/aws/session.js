const { spawn } = require("child_process");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { loadAuthFromRequest, ensureAuthToken } = require("../../../lib/keeper");

const loginTimeoutMs = 3 * 60 * 1000;

// The AWS CLI may live outside the PATH a GUI-launched dev server inherits.
const cliPath = [
  process.env.PATH,
  process.env.HOME ? `${process.env.HOME}/.local/bin` : null,
  "/opt/homebrew/bin",
  "/usr/local/bin",
]
  .filter(Boolean)
  .join(":");

async function sessionState() {
  const profile = process.env.AWS_PROFILE || "";
  try {
    const credentials = await new DynamoDBClient({}).config.credentials();
    return {
      profile,
      signedIn: true,
      expiration: credentials.expiration || null,
    };
  } catch (error) {
    return { profile, signedIn: false, reason: error.message };
  }
}

function ssoLogin(profile) {
  return new Promise((resolve, reject) => {
    const child = spawn("aws", ["sso", "login", "--profile", profile], {
      env: { ...process.env, PATH: cliPath },
    });

    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));

    const timer = setTimeout(() => child.kill(), loginTimeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not run the AWS CLI: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      if (signal) {
        return reject(new Error("Timed out waiting for the browser sign-in."));
      }
      reject(new Error(output.trim() || `aws sso login exited with ${code}.`));
    });
  });
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.json(await sessionState());
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    loadAuthFromRequest(req);
    ensureAuthToken();

    const profile = process.env.AWS_PROFILE;
    if (!profile) {
      return res
        .status(400)
        .json({ error: "AWS_PROFILE is not set. Add it to web/.env.local." });
    }

    await ssoLogin(profile);
    res.json(await sessionState());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}
