import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

export default function Home() {
  const [keeperApiUrl, setKeeperApiUrl] = useState("");
  const [keeperUsername, setKeeperUsername] = useState("");
  const [keeperPassword, setKeeperPassword] = useState("");
  const [targetName, setTargetName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [loginState, setLoginState] = useState("idle");
  const [previewState, setPreviewState] = useState("idle");
  const [provisionState, setProvisionState] = useState("idle");
  const [userState, setUserState] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [groupIdentifier, setGroupIdentifier] = useState("");
  const [userEmails, setUserEmails] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((res) => res.json())
      .then((data) => {
        setKeeperApiUrl(data.keeperApiUrl || "");
        setKeeperUsername(data.keeperUsername || "");
        setTargetName(data.targetName || "");
        setEnvironment(data.environment || "production");
      })
      .catch(() => {});
  }, []);

  const missingInstances = useMemo(() => {
    if (!preview?.instances) return [];
    return preview.instances.filter(
      (instance) => instance.needsConfig || instance.needsPassword
    );
  }, [preview]);

  function updateOverride(stackKey, field, value, imageId) {
    setOverrides((prev) => ({
      ...prev,
      [stackKey]: {
        stackKey,
        imageId,
        ...(prev[stackKey] || {}),
        [field]: value,
      },
    }));
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginState("loading");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keeperUsername,
          keeperPassword,
          keeperApiUrl,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Login failed.");
      }

      setLoginState("success");
      setMessage("Authenticated to Keeper.");
    } catch (err) {
      setLoginState("error");
      setError(err.message);
    }
  }

  async function handlePreview(event) {
    event.preventDefault();
    setPreviewState("loading");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/tenant/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetName,
          environment,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Preview failed.");
      }

      const payload = await response.json();
      setPreview(payload);
      setOverrides({});
      setPreviewState("success");
      setMessage(`Loaded tenant ${payload.tenant.name}.`);
    } catch (err) {
      setPreviewState("error");
      setError(err.message);
    }
  }

  async function handleProvision() {
    setProvisionState("loading");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/tenant/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetName,
          environment,
          overrides: Object.values(overrides),
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        const details = payload.details
          ? ` Missing: ${payload.details.map((item) => item.displayName).join(", ")}`
          : "";
        throw new Error((payload.error || "Provision failed.") + details);
      }

      const payload = await response.json();
      setProvisionState("success");
      setGroupIdentifier(payload.groupIdentifier || "");
      setMessage(`Created ${payload.addedConnections} connections.`);
    } catch (err) {
      setProvisionState("error");
      setError(err.message);
    }
  }

  async function handleAddUsers() {
    setUserState("loading");
    setError("");
    setMessage("");

    const users = userEmails
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      const response = await fetch(`${API_BASE}/api/users/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: targetName,
          users,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "User update failed.");
      }

      const payload = await response.json();
      setUserState("success");
      setMessage(
        `Updated ${payload.results.length} user(s). Connections in group: ${payload.connections}.`
      );
    } catch (err) {
      setUserState("error");
      setError(err.message);
    }
  }

  return (
    <main>
      <div className="container">
        <div className="hero">
          <h1>Keeper Connection Manager</h1>
          <p>
            Provision tenant connections and user access from DynamoDB into Keeper.
          </p>
          <div className="tag">
            Local mode <span aria-hidden="true">•</span> Express + Next
          </div>
        </div>

        <div className="grid">
          <section className="panel">
            <h2>1. Keeper Login</h2>
            <p>Authenticate to the Keeper API before provisioning.</p>
            <form className="fields" onSubmit={handleLogin}>
              <div className="row">
                <label>
                  Keeper API URL
                  <input
                    value={keeperApiUrl}
                    onChange={(event) => setKeeperApiUrl(event.target.value)}
                    placeholder="https://poc-access.sailpoint.com"
                  />
                </label>
                <label>
                  Username
                  <input
                    value={keeperUsername}
                    onChange={(event) => setKeeperUsername(event.target.value)}
                    placeholder="hyun.choi"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={keeperPassword}
                    onChange={(event) => setKeeperPassword(event.target.value)}
                    placeholder="••••••••"
                  />
                </label>
              </div>
              <div className="button-row">
                <button className="primary" type="submit">
                  {loginState === "loading" ? "Logging in..." : "Login"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setKeeperPassword("");
                    setLoginState("idle");
                  }}
                >
                  Clear Password
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <h2>2. Tenant Preview</h2>
            <p>Load the tenant from DynamoDB and inspect missing credentials.</p>
            <form className="fields" onSubmit={handlePreview}>
              <div className="row">
                <label>
                  Tenant Name
                  <input
                    value={targetName}
                    onChange={(event) => setTargetName(event.target.value)}
                    placeholder="company0000-poc"
                  />
                </label>
                <label>
                  Environment
                  <select
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                  >
                    <option value="production">Production</option>
                    <option value="test">Development</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button className="primary" type="submit">
                  {previewState === "loading" ? "Loading..." : "Load Tenant"}
                </button>
              </div>
            </form>

            {preview && (
              <div className="status">
                <strong>Tenant:</strong> {preview.tenant.name}
                {preview.tenant.guid ? ` • ${preview.tenant.guid}` : ""}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>3. Fill Missing Credentials</h2>
            <p>Only required when Secrets Manager lacks protocol or password.</p>
            {!missingInstances.length ? (
              <div className="status">No missing credentials detected.</div>
            ) : (
              <div className="list">
                {missingInstances.map((instance) => (
                  <div className="list-item" key={instance.stackKey}>
                    <h3>{instance.displayName}</h3>
                    <small>{instance.imageId}</small>
                    <div className="row" style={{ marginTop: 10 }}>
                      {instance.needsConfig && (
                        <>
                          <label>
                            Protocol
                            <select
                              value={overrides[instance.stackKey]?.protocol || ""}
                              onChange={(event) =>
                                updateOverride(
                                  instance.stackKey,
                                  "protocol",
                                  event.target.value,
                                  instance.imageId
                                )
                              }
                            >
                              <option value="">Select</option>
                              <option value="rdp">RDP</option>
                              <option value="ssh">SSH</option>
                            </select>
                          </label>
                          <label>
                            Username
                            <input
                              value={overrides[instance.stackKey]?.username || ""}
                              onChange={(event) =>
                                updateOverride(
                                  instance.stackKey,
                                  "username",
                                  event.target.value,
                                  instance.imageId
                                )
                              }
                            />
                          </label>
                        </>
                      )}
                      {instance.needsPassword && (
                        <label>
                          Password
                          <input
                            type="password"
                            value={overrides[instance.stackKey]?.password || ""}
                            onChange={(event) =>
                              updateOverride(
                                instance.stackKey,
                                "password",
                                event.target.value,
                                instance.imageId
                              )
                            }
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>4. Provision Connections</h2>
            <p>Create connection groups and connections in Keeper.</p>
            <div className="button-row">
              <button className="primary" type="button" onClick={handleProvision}>
                {provisionState === "loading" ? "Provisioning..." : "Create Connections"}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setPreview(null);
                  setOverrides({});
                  setProvisionState("idle");
                }}
              >
                Reset Preview
              </button>
            </div>
            {groupIdentifier && (
              <div className="status">
                <span className="pill ok">Group ID</span> {groupIdentifier}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>5. Add Users</h2>
            <p>Grant group and connection permissions to users.</p>
            <div className="fields">
              <label>
                User Emails (comma or new line separated)
                <textarea
                  value={userEmails}
                  onChange={(event) => setUserEmails(event.target.value)}
                  placeholder="first.last@company.com"
                />
              </label>
              <div className="button-row">
                <button className="primary" type="button" onClick={handleAddUsers}>
                  {userState === "loading" ? "Updating..." : "Add Users"}
                </button>
              </div>
            </div>
          </section>

          {(message || error) && (
            <section className="panel">
              <h2>Status</h2>
              {message && (
                <div className="status">
                  <span className="pill ok">OK</span> {message}
                </div>
              )}
              {error && (
                <div className="status">
                  <span className="pill bad">Error</span> {error}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
