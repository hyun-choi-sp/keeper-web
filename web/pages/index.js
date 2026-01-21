import { useEffect, useMemo, useState } from "react";
import Nav from "../components/Nav";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export default function Home() {
  const [keeperApiUrl, setKeeperApiUrl] = useState("");
  const [keeperUsername, setKeeperUsername] = useState("");
  const [keeperPassword, setKeeperPassword] = useState("");
  const [targetName, setTargetName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [loginState, setLoginState] = useState("idle");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(true);
  const [previewState, setPreviewState] = useState("idle");
  const [provisionState, setProvisionState] = useState("idle");
  const [userState, setUserState] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [groupIdentifier, setGroupIdentifier] = useState("");
  const [previewGroupIdentifier, setPreviewGroupIdentifier] = useState("");
  const [awsEnv, setAwsEnv] = useState("");
  const [userEmails, setUserEmails] = useState("");
  const [deleteState, setDeleteState] = useState("idle");
  const [deletedConnections, setDeletedConnections] = useState({});
  const [pollingState, setPollingState] = useState("idle");
  const [dangerOpen, setDangerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [statusMinimized, setStatusMinimized] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/config`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setKeeperApiUrl(data.keeperApiUrl || "");
        setKeeperUsername(data.keeperUsername || "");
        setTargetName(data.targetName || "");
        setEnvironment(data.environment || "production");
      })
      .catch(() => {});
  }, []);

  const actionInstances = useMemo(() => {
    if (!preview?.instances) return [];
    return preview.instances.filter(
      (instance) => instance.needsConfig || instance.needsPassword || instance.exists
    );
  }, [preview]);

  const existingInstances = useMemo(() => {
    if (!preview?.instances) return [];
    return preview.instances.filter((instance) => instance.exists);
  }, [preview]);

  const hasUpdates = existingInstances.length > 0;
  const provisionLabel = hasUpdates ? "Update Connections" : "Create Connections";
  const provisioningLabel = hasUpdates ? "Updating..." : "Provisioning...";

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

  function applySuggestedUsername(stackKey, imageId, value) {
    updateOverride(stackKey, "username", value, imageId);
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
        credentials: "include",
        body: JSON.stringify({
          keeperUsername,
          keeperPassword,
          keeperApiUrl,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        const details = payload.details ? ` (${payload.details})` : "";
        throw new Error((payload.error || "Login failed.") + details);
      }

      setLoginState("success");
      setIsAuthenticated(true);
      setShowLoginForm(false);
      setMessage("Authenticated to Keeper.");
    } catch (err) {
      setLoginState("error");
      setIsAuthenticated(false);
      setError(err.message);
    }
  }

  async function handleLogout() {
    setLoginState("loading");
    setError("");
    setMessage("");

    try {
      await fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        credentials: "include",
      });
      setLoginState("idle");
      setIsAuthenticated(false);
      setShowLoginForm(true);
      setMessage("Logged out.");
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
        credentials: "include",
        body: JSON.stringify({
          targetName,
          environment,
          awsEnv,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Preview failed.");
      }

      const payload = await response.json();
      setPreview(payload);
      setPreviewGroupIdentifier(payload.groupIdentifier || "");
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
        credentials: "include",
        body: JSON.stringify({
          targetName,
          environment,
          overrides: Object.values(overrides),
          awsEnv,
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
      await pollPreview({ attempts: 6, intervalMs: 5000 });
    } catch (err) {
      setProvisionState("error");
      setError(err.message);
    }
  }

  async function refreshPreview() {
    setPreviewState("loading");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/tenant/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          targetName,
          environment,
          awsEnv,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Preview failed.");
      }

      const payload = await response.json();
      setPreview(payload);
      setPreviewGroupIdentifier(payload.groupIdentifier || "");
      setPreviewState("success");
      setMessage(`Loaded tenant ${payload.tenant.name}.`);
      return payload;
    } catch (err) {
      setPreviewState("error");
      setError(err.message);
      return null;
    }
  }

  async function pollPreview({ attempts = 5, intervalMs = 4000 } = {}) {
    setPollingState("polling");
    for (let i = 0; i < attempts; i += 1) {
      const payload = await refreshPreview();
      if (payload) {
        setPollingState("verified");
        return payload;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    setPollingState("timeout");
    return null;
  }

  async function handleDeleteConnection(instance) {
    if (!instance?.connectionId) return;
    const confirmed = window.confirm(
      `Delete connection "${instance.connectionName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleteState("loading");
    setDeletedConnections((prev) => ({
      ...prev,
      [instance.stackKey]: "deleting",
    }));
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/tenant/delete-connection`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ connectionId: instance.connectionId }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Delete failed.");
      }

      setDeleteState("success");
      setMessage(`Deleted connection ${instance.connectionName}.`);
      setDeletedConnections((prev) => ({
        ...prev,
        [instance.stackKey]: "verifying",
      }));
      setPreview((prev) => {
        if (!prev?.instances) return prev;
        return {
          ...prev,
          instances: prev.instances.map((item) => {
            if (item.connectionId !== instance.connectionId) return item;
            return {
              ...item,
              exists: false,
              connectionId: null,
              connectionName: null,
              existingProtocol: null,
              existingUsername: null,
              suggestedUsername: null,
            };
          }),
        };
      });
      const payload = await pollPreview({ attempts: 5, intervalMs: 4000 });
      const stillExists = payload?.instances?.some(
        (item) => item.stackKey === instance.stackKey && item.exists
      );
      setDeletedConnections((prev) => ({
        ...prev,
        [instance.stackKey]: stillExists ? "failed" : "verified",
      }));
      window.setTimeout(() => {
        setDeletedConnections((prev) => {
          const next = { ...prev };
          delete next[instance.stackKey];
          return next;
        });
      }, stillExists ? 2000 : 1200);
    } catch (err) {
      setDeleteState("error");
      setDeletedConnections((prev) => ({
        ...prev,
        [instance.stackKey]: "idle",
      }));
      setError(err.message);
    }
  }

  async function handleDeleteGroup() {
    if (!groupIdentifier && !targetName) return;
    const expected = `DELETE ${targetName}`;
    if (deleteConfirm !== expected) {
      setError(`Type "${expected}" to confirm.`);
      return;
    }

    setDeleteState("loading");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/tenant/delete-group`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          groupIdentifier: previewGroupIdentifier || groupIdentifier,
          groupName: targetName,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Delete failed.");
      }

      setDeleteState("success");
      setMessage(`Deleted group ${targetName}.`);
      setGroupIdentifier("");
      setPreviewGroupIdentifier("");
      setDangerOpen(false);
      setDeleteConfirm("");
      await pollPreview({ attempts: 4, intervalMs: 4000 });
    } catch (err) {
      setDeleteState("error");
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
        credentials: "include",
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
      <Nav />
      <div className="container">
        <div className="hero">
          <h1>Keeper Connection Manager</h1>
          <p>
            Provision tenant connections and user access from DynamoDB into Keeper.
          </p>
          <div className="tag">
            Local mode <span aria-hidden="true">•</span> Next.js (UI + API)
          </div>
        </div>

        <div className="stepper sticky-stepper">
          <div className="stepper-row">
            <div
              className={`step ${
                loginState === "loading" ? "loading" : isAuthenticated ? "active" : ""
              }`}
            >
              <div className="step-head">
                <span className="step-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2l7 3v6c0 5-3.5 8.5-7 11-3.5-2.5-7-6-7-11V5l7-3z" />
                    <path d="M9.5 12.5l1.7 1.7 3.4-3.4" />
                  </svg>
                </span>
                <span className={`pill ${isAuthenticated ? "ok" : "warn"}`}>
                  {loginState === "loading" ? "Logging in" : "Login"}
                </span>
                <div className="step-title">Keeper Access</div>
              </div>
              <div className="step-detail">
                {isAuthenticated ? `Signed in as ${keeperUsername}` : "Provide credentials"}
              </div>
            </div>
            <div
              className={`step ${
                previewState === "loading" ? "loading" : previewState === "success" ? "active" : ""
              }`}
            >
              <div className="step-head">
                <span className="step-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 5h16v11H4z" />
                    <path d="M8 20h8" />
                    <path d="M9 8h6M9 11h6" />
                  </svg>
                </span>
                <span className={`pill ${previewState === "success" ? "ok" : "warn"}`}>
                  {previewState === "loading" ? "Loading" : "Preview"}
                </span>
                <div className="step-title">Tenant Preview</div>
              </div>
              <div className="step-detail">
                {previewState === "success" ? "Tenant data loaded" : "Query DynamoDB"}
              </div>
            </div>
            <div
              className={`step ${
                provisionState === "loading"
                  ? "loading"
                  : provisionState === "success"
                  ? "active"
                  : ""
              }`}
            >
              <div className="step-head">
                <span className="step-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16v10H4z" />
                    <path d="M8 7v-2h8v2" />
                    <path d="M12 10v4" />
                    <path d="M10 12h4" />
                  </svg>
                </span>
                <span className={`pill ${provisionState === "success" ? "ok" : "warn"}`}>
                  {provisionState === "loading" ? "Working" : "Provision"}
                </span>
                <div className="step-title">Credentials & Provision</div>
              </div>
              <div className="step-detail">
                {provisionState === "success" ? "Connections created" : "Fill missing data"}
              </div>
            </div>
            <div
              className={`step ${
                userState === "loading" ? "loading" : userState === "success" ? "active" : ""
              }`}
            >
              <div className="step-head">
                <span className="step-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8.5 10a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8.5 10z" />
                    <path d="M15.5 10a3 3 0 1 0-3-3 3 3 0 0 0 3 3z" />
                    <path d="M4 20v-1.5A4.5 4.5 0 0 1 8.5 14h0A4.5 4.5 0 0 1 13 18.5V20" />
                    <path d="M13 20v-1a4 4 0 0 1 4-4h0a3 3 0 0 1 3 3v2" />
                  </svg>
                </span>
                <span className={`pill ${userState === "success" ? "ok" : "warn"}`}>
                  {userState === "loading" ? "Working" : "Users"}
                </span>
                <div className="step-title">Access Management</div>
              </div>
              <div className="step-detail">
                {userState === "success" ? "Users updated" : "Grant access"}
              </div>
            </div>
          </div>
        </div>

        <div className="grid">
          <section className="panel">
            <h2>1. Keeper Login</h2>
            <p>Authenticate to the Keeper API before provisioning.</p>
            <div className="login-card">
              <div className="status">
                {isAuthenticated ? (
                  <>
                    <span className="pill ok">Authenticated</span>{" "}
                    <strong>{keeperUsername}</strong>
                  </>
                ) : (
                  <span className="pill warn">Not Authenticated</span>
                )}
              </div>
              {isAuthenticated && !showLoginForm ? (
                <div className="login-summary">
                  <div className="login-summary-row">
                    <span className="pill ok">Active</span>
                    <strong>{keeperApiUrl}</strong>
                  </div>
                  <div className="button-row">
                    <button className="secondary" type="button" onClick={handleLogout}>
                      {loginState === "loading" ? "Logging out..." : "Logout"}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setShowLoginForm(true)}
                    >
                      Edit Credentials
                    </button>
                  </div>
                </div>
              ) : (
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
              )}
            </div>
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
              <label>
                AWS Session Env (paste export block here)
                <textarea
                  value={awsEnv}
                  onChange={(event) => setAwsEnv(event.target.value)}
                  placeholder={'export AWS_ACCESS_KEY_ID="..."\nexport AWS_SECRET_ACCESS_KEY="..."\nexport AWS_SESSION_TOKEN="..."'}
                />
              </label>
              <div className="button-row">
                <button className="primary" type="submit">
                  {previewState === "loading" ? "Loading..." : "Load Tenant"}
                </button>
              </div>
              {previewState === "error" && error && (
                <div className="status">
                  <span className="pill bad">Error</span> {error}
                </div>
              )}
            </form>

            {preview && (
              <div className="status">
                <strong>Tenant:</strong> {preview.tenant.name}
                {preview.tenant.guid ? ` • ${preview.tenant.guid}` : ""}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>3. Credentials & Provision</h2>
            <p>Fill missing credentials and create Keeper connections in one step.</p>
            {!actionInstances.length ? (
              <div className="status">No missing credentials detected.</div>
            ) : (
              <div className="list">
                {actionInstances.map((instance) => (
                  <div className="list-item" key={instance.stackKey}>
                    <h3>{instance.displayName}</h3>
                    <small>{instance.imageId}</small>
                    {instance.exists && (
                      <div className="status status-split">
                        <span className="pill ok">Already Exists</span>{" "}
                        {instance.connectionName}
                        <span className="status-spacer" />
                        {deletedConnections[instance.stackKey] === "deleting" ? (
                          <button className="danger-button" type="button" disabled>
                            Deleting...
                          </button>
                        ) : deletedConnections[instance.stackKey] === "verifying" ? (
                          <button className="danger-button" type="button" disabled>
                            Verifying...
                          </button>
                        ) : deletedConnections[instance.stackKey] === "verified" ? (
                          <button className="danger-button" type="button" disabled>
                            Available
                          </button>
                        ) : deletedConnections[instance.stackKey] === "failed" ? (
                          <button className="danger-button" type="button" disabled>
                            Still Exists
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDeleteConnection(instance)}
                          >
                            Delete Connection
                          </button>
                        )}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 10 }}>
                      {(instance.needsConfig || instance.exists) && (
                        <>
                          <label>
                            Protocol
                            <select
                              value={
                                overrides[instance.stackKey]?.protocol ||
                                instance.existingProtocol ||
                                ""
                              }
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
                              value={
                                overrides[instance.stackKey]?.username ||
                                instance.existingUsername ||
                                ""
                              }
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
                      {(instance.needsConfig ||
                        instance.needsPassword ||
                        instance.exists) && (
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
                    {instance.exists && (
                      <div className="status">
                        <span className="pill warn">Note</span> Username/password
                        cannot be fetched from Keeper. Leave empty to keep existing
                        values, or enter new values to update.
                      </div>
                    )}
                    {instance.exists &&
                      !instance.existingUsername &&
                      instance.suggestedUsername && (
                        <div className="status">
                          <span className="pill ok">Suggestion</span>{" "}
                          {instance.suggestedUsername}{" "}
                          <button
                            type="button"
                            className="link-button"
                            onClick={() =>
                              applySuggestedUsername(
                                instance.stackKey,
                                instance.imageId,
                                instance.suggestedUsername
                              )
                            }
                          >
                            Use
                          </button>
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
            {existingInstances.length > 0 && (
              <div className="status status-gap">
                <span className="pill warn">
                  {existingInstances.length} existing connection(s)
                </span>{" "}
                in Keeper for this tenant
              </div>
            )}
            {previewGroupIdentifier && (
              <div className={`delete-panel ${dangerOpen ? "open" : ""}`}>
                <div
                  className="danger-header"
                  role="button"
                  tabIndex={0}
                  onClick={() => setDangerOpen((prev) => !prev)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setDangerOpen((prev) => !prev);
                    }
                  }}
                >
                  <span className="pill bad">Danger Zone</span>
                  <span>Delete tenant group and all connections</span>
                  <span className="danger-chevron">{dangerOpen ? "–" : "+"}</span>
                </div>
                {dangerOpen && (
                  <>
                    <label>
                      Type <strong>{`DELETE ${targetName}`}</strong> to confirm
                      <input
                        value={deleteConfirm}
                        onChange={(event) => setDeleteConfirm(event.target.value)}
                        placeholder={`DELETE ${targetName}`}
                      />
                    </label>
                    <div className="button-row">
                      <button
                        className="danger-button"
                        type="button"
                        onClick={handleDeleteGroup}
                        disabled={deleteState === "loading"}
                      >
                        {deleteState === "loading"
                          ? "Deleting..."
                          : "Delete Tenant Group"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="button-row">
              <button className="primary" type="button" onClick={handleProvision}>
                {provisionState === "loading" ? provisioningLabel : provisionLabel}
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
            {pollingState === "polling" && (
              <div className="status">
                <span className="pill warn">Syncing</span> Waiting for Keeper to
                reflect new connections...
              </div>
            )}
            {pollingState === "timeout" && (
              <div className="status">
                <span className="pill bad">Delayed</span> Status update is taking
                longer than expected. Try again shortly.
              </div>
            )}
            {groupIdentifier && (
              <div className="status">
                <span className="pill ok">Group ID</span> {groupIdentifier}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>4. Add Users</h2>
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
            <div className={statusMinimized ? "status-float minimized" : "status-float"}>
              <button
                type="button"
                className="status-toggle"
                onClick={() => setStatusMinimized((prev) => !prev)}
                aria-label={statusMinimized ? "Show status" : "Minimize status"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2a7 7 0 0 0-7 7v3.2l-1.4 2.8a1 1 0 0 0 .9 1.5h15a1 1 0 0 0 .9-1.5L19 12.2V9a7 7 0 0 0-7-7z" />
                  <path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
                </svg>
                <span className={error ? "status-badge danger" : "status-badge"}>
                  {error ? "!" : "1"}
                </span>
              </button>
              {!statusMinimized && (
                <div className="status-body">
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
