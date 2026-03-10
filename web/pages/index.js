import { useEffect, useMemo, useState } from "react";
import Nav from "../components/Nav";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const WINDOWS_DEFAULT_PASSWORD = "Sailp0!nt";
const LINUX_DEFAULT_PASSWORD = "S@ilp0int";

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
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorQueue, setErrorQueue] = useState([]);
  const [errorHistory, setErrorHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [shareLinks, setShareLinks] = useState({});
  const [shareLoading, setShareLoading] = useState({});
  const [stackPulse, setStackPulse] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [emailDraft, setEmailDraft] = useState("");

  const errorDisplayMs = 10000;
  const errorFadeMs = 1500;
  const errorMaxCount = 10;
  const initialUserPassword = WINDOWS_DEFAULT_PASSWORD;

  function toDisplayName(value) {
    if (!value) return "Customer";
    return value
      .split(/[.\-_@\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function buildUserCredentialLines(results) {
    return results
      .filter((item) => item?.status === "ok" && item.email)
      .map((item) =>
        item.created
          ? `Username: ${item.email} / Temporary password: ${item.password || initialUserPassword}`
          : `Username: ${item.email} / Password: Use the user's existing Keeper password`
      );
  }

  function buildUserEmailDraft(results) {
    const successfulResults = results.filter((item) => item?.status === "ok" && item.email);
    if (!successfulResults.length) return "";

    const customerName = "Customer";
    const environmentName = preview?.tenant?.name || targetName || "N/A";
    const credentialLines = buildUserCredentialLines(successfulResults);
    const hasExistingUsers = successfulResults.some((item) => !item.created);
    const passwordGuidance = hasExistingUsers
      ? "For any existing Keeper user, keep the current password. For any newly created user, the temporary password is listed above and must be changed at first sign-in."
      : "Each user above was created with the temporary password listed above and will be prompted to change it at first sign-in.";

    return [
      `Hi ${customerName},`,
      "",
      "The Keeper remote access has been configured for the requested user(s). Please find the details below.",
      "",
      `Environment: ${environmentName}`,
      "Remote access link: https://poc-access.sailpoint.com/",
      "",
      ...credentialLines,
      "",
      "Please share this information with the end user(s), as we do not send these credentials directly.",
      passwordGuidance,
      "If a user signs in with a temporary password, please ask them to change it immediately after the first login.",
      "",
      "To change the password in Keeper Connection Manager (KCM):",
      "1. Open the connection settings by pressing Ctrl + Shift + Win (Ctrl + Shift + Cmd on Mac).",
      "2. Click your name in the upper-right corner to expand the menu.",
      "3. Go to Settings.",
      "4. Select the Preferences tab.",
      "5. Change your password.",
      "",
      "Please let me know if you have any questions or concerns.",
    ].join("\n");
  }

  function pushError(nextError) {
    if (!nextError) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setStatusMinimized(false);
    setShowHistory(false);
    setError(nextError);
    setErrorHistory((prev) => {
      const next = [{ id, message: nextError, kind: "error" }, ...prev];
      if (next.length > errorMaxCount) {
        return next.slice(0, errorMaxCount);
      }
      return next;
    });
    setErrorQueue((prev) => {
      const next = [
        { id, message: nextError, kind: "error", fading: false, fresh: true },
        ...prev,
      ];
      if (next.length > errorMaxCount) {
        return next.slice(0, errorMaxCount);
      }
      return next;
    });

    setStackPulse(true);
    window.setTimeout(() => {
      setStackPulse(false);
    }, 260);

    window.setTimeout(() => {
      setErrorQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, fresh: false } : item))
      );
    }, 240);

    window.setTimeout(() => {
      setErrorQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, fading: true } : item))
      );
    }, errorDisplayMs);

    window.setTimeout(() => {
      setErrorQueue((prev) => prev.filter((item) => item.id !== id));
    }, errorDisplayMs + errorFadeMs);
  }

  function pushOk(nextMessage) {
    if (!nextMessage) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setStatusMinimized(false);
    setShowHistory(false);
    setErrorHistory((prev) => {
      const next = [{ id, message: nextMessage, kind: "ok" }, ...prev];
      if (next.length > errorMaxCount) {
        return next.slice(0, errorMaxCount);
      }
      return next;
    });
    setErrorQueue((prev) => {
      const next = [
        { id, message: nextMessage, kind: "ok", fading: false, fresh: true },
        ...prev,
      ];
      if (next.length > errorMaxCount) {
        return next.slice(0, errorMaxCount);
      }
      return next;
    });

    setStackPulse(true);
    window.setTimeout(() => {
      setStackPulse(false);
    }, 260);

    window.setTimeout(() => {
      setErrorQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, fresh: false } : item))
      );
    }, 240);

    window.setTimeout(() => {
      setErrorQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, fading: true } : item))
      );
    }, errorDisplayMs);

    window.setTimeout(() => {
      setErrorQueue((prev) => prev.filter((item) => item.id !== id));
    }, errorDisplayMs + errorFadeMs);
  }

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

  const assignedUsers = useMemo(() => {
    if (!preview?.instances) return [];
    const seen = new Set();
    preview.instances.forEach((instance) => {
      (instance.assignedUsers || []).forEach((user) => seen.add(user));
    });
    return Array.from(seen).sort();
  }, [preview]);

  const instanceByStackKey = useMemo(() => {
    const entries = preview?.instances || [];
    return entries.reduce((acc, instance) => {
      acc[instance.stackKey] = instance;
      return acc;
    }, {});
  }, [preview]);

  const hasUpdates = existingInstances.length > 0;
  const provisionLabel = hasUpdates ? "Update Connections" : "Create Connections";
  const provisioningLabel = hasUpdates ? "Updating..." : "Provisioning...";
  const hasActionableChanges = useMemo(() => {
    if (!preview?.instances) return false;

    return preview.instances.some((instance) => {
      const override = overrides[instance.stackKey];
      if (instance.exists) {
        if (!override?.updateExisting) return false;
        return Boolean(override.protocol || override.username || override.password);
      }

      if (!instance.needsConfig && !instance.needsPassword) {
        return true;
      }

      if (!override) return false;
      return Boolean(override.protocol || override.username || override.password);
    });
  }, [preview, overrides]);

  function getDefaultProtocol(instance) {
    if (!instance) return "";
    return instance.existingProtocol || instance.protocol || "";
  }

  function getCurrentProtocol(instance) {
    return overrides[instance.stackKey]?.protocol || getDefaultProtocol(instance);
  }

  function getCurrentUsername(instance) {
    return (
      overrides[instance.stackKey]?.username ||
      instance.existingUsername ||
      instance.username ||
      ""
    );
  }

  function getQuickUsernameValue(instance) {
    const protocol = getCurrentProtocol(instance);
    const username = getCurrentUsername(instance).toLowerCase();

    if (protocol === "rdp" && username === "administrator") {
      return "administrator";
    }
    if (protocol === "ssh" && username === "sailpoint") {
      return "sailpoint";
    }
    return "custom";
  }

  function getDefaultPasswordForProtocol(protocol) {
    if (protocol === "rdp") return WINDOWS_DEFAULT_PASSWORD;
    if (protocol === "ssh") return LINUX_DEFAULT_PASSWORD;
    return "";
  }

  function updateOverride(stackKey, field, value, imageId) {
    const instance = instanceByStackKey[stackKey];
    const defaultProtocol = getDefaultProtocol(instance);
    setOverrides((prev) => ({
      ...prev,
      [stackKey]: {
        stackKey,
        imageId,
        ...(prev[stackKey] || {}),
        ...(field !== "protocol" && defaultProtocol && !prev[stackKey]?.protocol
          ? { protocol: defaultProtocol }
          : {}),
        [field]: value,
      },
    }));
  }

  function applySuggestedUsername(stackKey, imageId, value) {
    updateOverride(stackKey, "username", value, imageId);
  }

  function toggleUpdateExisting(stackKey, imageId, enabled) {
    const instance = instanceByStackKey[stackKey];
    const defaultProtocol = getDefaultProtocol(instance);
    setOverrides((prev) => {
      const next = { ...prev };
      if (enabled) {
        next[stackKey] = {
          stackKey,
          imageId,
          ...(prev[stackKey] || {}),
          ...(defaultProtocol && !prev[stackKey]?.protocol
            ? { protocol: defaultProtocol }
            : {}),
          updateExisting: true,
        };
      } else {
        delete next[stackKey];
      }
      return next;
    });
  }

  function applyCredentialTemplate(instance, value) {
    if (value === "custom") return;

    if (value === "administrator") {
      setOverrides((prev) => ({
        ...prev,
        [instance.stackKey]: {
          stackKey: instance.stackKey,
          imageId: instance.imageId,
          ...(prev[instance.stackKey] || {}),
          protocol: "rdp",
          username: "administrator",
          password: WINDOWS_DEFAULT_PASSWORD,
        },
      }));
      return;
    }

    if (value === "sailpoint") {
      setOverrides((prev) => ({
        ...prev,
        [instance.stackKey]: {
          stackKey: instance.stackKey,
          imageId: instance.imageId,
          ...(prev[instance.stackKey] || {}),
          protocol: "ssh",
          username: "sailpoint",
          password: LINUX_DEFAULT_PASSWORD,
        },
      }));
    }
  }

  function togglePasswordVisibility(stackKey) {
    setVisiblePasswords((prev) => ({
      ...prev,
      [stackKey]: !prev[stackKey],
    }));
  }

  function buildProvisionOverrides() {
    return Object.values(overrides).map((override) => {
      const instance = instanceByStackKey[override.stackKey];
      const defaultProtocol = getDefaultProtocol(instance);
      if (override.protocol || !defaultProtocol) {
        return override;
      }
      return {
        ...override,
        protocol: defaultProtocol,
      };
    });
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
      pushOk("Authenticated to Keeper.");
    } catch (err) {
      setLoginState("error");
      setIsAuthenticated(false);
      pushError(err.message);
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
      setPreview(null);
      setGroupIdentifier("");
      setPreviewGroupIdentifier("");
      setOverrides({});
      setAwsEnv("");
      setUserEmails("");
      setDeleteState("idle");
      setDeletedConnections({});
      setPollingState("idle");
      setDangerOpen(false);
      setDeleteConfirm("");
      setShareLinks({});
      setShareLoading({});
      setStatusMinimized(false);
      setShowHistory(false);
      setShowInitialPassword(false);
      setVisiblePasswords({});
      setEmailDraft("");
      setErrorQueue([]);
      setErrorHistory([]);
      pushOk("Logged out.");
    } catch (err) {
      setLoginState("error");
      pushError(err.message);
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
      setShareLinks({});
      setShareLoading({});
      setOverrides({});
      setVisiblePasswords({});
      setEmailDraft("");
      setPreviewState("success");
      pushOk(`Loaded tenant ${payload.tenant.name}.`);
    } catch (err) {
      setPreviewState("error");
      pushError(err.message);
    }
  }

  async function handleProvision() {
    if (!hasActionableChanges) {
      pushError("No changes to apply.");
      return;
    }

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
          overrides: buildProvisionOverrides(),
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
      pushOk(`Created ${payload.addedConnections} connections.`);
      await pollPreview({ attempts: 6, intervalMs: 5000 });
    } catch (err) {
      setProvisionState("error");
      pushError(err.message);
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
      setShareLinks({});
      setShareLoading({});
      setOverrides({});
      setVisiblePasswords({});
      setEmailDraft("");
      setPreviewState("success");
      pushOk(`Loaded tenant ${payload.tenant.name}.`);
      return payload;
    } catch (err) {
      setPreviewState("error");
      pushError(err.message);
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
      pushOk(`Deleted connection ${instance.connectionName}.`);
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
      pushError(err.message);
    }
  }

  async function handleDeleteGroup() {
    if (!groupIdentifier && !targetName) return;
    const expected = `DELETE ${targetName}`;
    if (deleteConfirm !== expected) {
      pushError(`Type "${expected}" to confirm.`);
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
      pushOk(`Deleted group ${targetName}.`);
      setGroupIdentifier("");
      setPreviewGroupIdentifier("");
      setDangerOpen(false);
      setDeleteConfirm("");
      await pollPreview({ attempts: 4, intervalMs: 4000 });
    } catch (err) {
      setDeleteState("error");
      pushError(err.message);
    }
  }

  async function handleGenerateShareLink(instance) {
    if (!instance?.connectionId) {
      pushError("Connection not found.");
      return;
    }

    setShareLoading((prev) => ({ ...prev, [instance.stackKey]: true }));
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/api/tenant/share-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          connectionId: instance.connectionId,
          sharingProfileId: instance.sharingProfileIdentifier,
          sharingProfileName: instance.sharingProfileName,
          connectionName: instance.connectionName,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Share link failed.");
      }

      const payload = await response.json();
      setShareLinks((prev) => ({ ...prev, [instance.stackKey]: payload.link }));
      if (payload.sharingProfileId && !instance.sharingProfileIdentifier) {
        setPreview((prev) => {
          if (!prev?.instances) return prev;
          return {
            ...prev,
            instances: prev.instances.map((item) => {
              if (item.stackKey !== instance.stackKey) return item;
              return {
                ...item,
                sharingProfileExists: true,
                sharingProfileIdentifier: payload.sharingProfileId,
                sharingProfileName: item.sharingProfileName || instance.connectionName,
              };
            }),
          };
        });
      }
      pushOk("Sharing link generated.");
    } catch (err) {
      pushError(err.message);
    } finally {
      setShareLoading((prev) => ({ ...prev, [instance.stackKey]: false }));
    }
  }

  async function handleAddUsers() {
    const users = userEmails
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (users.length === 0) {
      setUserState("idle");
      pushError("Add at least one user email.");
      return;
    }

    setUserState("loading");
    setError("");
    setMessage("");

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
      const draft = buildUserEmailDraft(payload.results || []);
      setEmailDraft(draft);
      setUserState("success");
      pushOk(
        `Updated ${payload.results.length} user(s). Connections in group: ${payload.connections}.`
      );
    } catch (err) {
      setUserState("error");
      pushError(err.message);
    }
  }

  async function handleCopyInitialPassword() {
    if (!navigator?.clipboard) {
      pushError("Clipboard unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(initialUserPassword);
      pushOk("Initial password copied.");
    } catch (err) {
      pushError("Failed to copy password.");
    }
  }

  async function handleCopyShareLink(link) {
    if (!link) return;
    if (!navigator?.clipboard) {
      pushError("Clipboard unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      pushOk("Sharing link copied.");
    } catch (err) {
      pushError("Failed to copy link.");
    }
  }

  async function handleCopyEmailDraft() {
    if (!emailDraft) {
      pushError("No email draft to copy.");
      return;
    }
    if (!navigator?.clipboard) {
      pushError("Clipboard unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(emailDraft);
      pushOk("Email draft copied.");
    } catch (err) {
      pushError("Failed to copy email draft.");
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
                {actionInstances.map((instance) => {
                  const updatesEnabled = Boolean(
                    overrides[instance.stackKey]?.updateExisting
                  );
                  const updatesBlocked = instance.exists && !updatesEnabled;
                  return (
                    <div className="list-item connection-card" key={instance.stackKey}>
                      <div className="card-header">
                        <div>
                          <h3>
                            {instance.displayName}
                            {instance.osLabel ? (
                              <span className="os-label"> ({instance.osLabel})</span>
                            ) : null}
                          </h3>
                          <small className="card-meta">{instance.imageId}</small>
                        </div>
                        {instance.exists && (
                          <div className="status-actions">
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
                      </div>
                      <div className="status-row">
                        <div className="status-group">
                          <div className="status-line">
                            {instance.exists ? (
                              <span className="pill ok">Already Exists</span>
                            ) : (
                              <span className="pill warn">New Connection</span>
                            )}
                            {instance.connectionName ? (
                              <span
                                className="status-text"
                                title={instance.connectionName}
                              >
                                {instance.connectionName}
                              </span>
                            ) : null}
                          </div>
                          {instance.exists && (
                            <div className="status-line">
                              <span
                                className={`pill ${
                                  instance.sharingProfileExists ? "ok" : "warn"
                                }`}
                              >
                                Sharing Profile{" "}
                                {instance.sharingProfileExists ? "Present" : "Missing"}
                              </span>
                              {instance.sharingProfileExists &&
                              instance.sharingProfileName ? (
                                <span
                                  className="status-text"
                                  title={instance.sharingProfileName}
                                >
                                  {instance.sharingProfileName}
                                </span>
                              ) : null}
                            </div>
                          )}
                          {instance.exists && (
                            <div className="status-line">
                              <button
                                className="link-button"
                                type="button"
                                onClick={() => handleGenerateShareLink(instance)}
                                disabled={shareLoading[instance.stackKey]}
                              >
                                {shareLoading[instance.stackKey]
                                  ? "Generating link..."
                                  : "Generate Sharing Link"}
                              </button>
                              {shareLinks[instance.stackKey] ? (
                                <>
                                  <a
                                    className="status-text status-link"
                                    href={shareLinks[instance.stackKey]}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={shareLinks[instance.stackKey]}
                                  >
                                    {shareLinks[instance.stackKey]}
                                  </a>
                                  <button
                                    type="button"
                                    className="icon-button"
                                    onClick={() =>
                                      handleCopyShareLink(shareLinks[instance.stackKey])
                                    }
                                    aria-label="Copy sharing link"
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <rect x="8" y="8" width="12" height="12" rx="2" />
                                      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                                    </svg>
                                  </button>
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                        {instance.exists && (
                          <label className="inline-checkbox">
                            <input
                              type="checkbox"
                              checked={updatesEnabled}
                              onChange={(event) =>
                                toggleUpdateExisting(
                                  instance.stackKey,
                                  instance.imageId,
                                  event.target.checked
                                )
                              }
                            />
                            Enable updates
                          </label>
                        )}
                      </div>
                      <div className="row" style={{ marginTop: 10 }}>
                        {(instance.needsConfig || instance.exists) && (
                          <>
                            <label className={updatesBlocked ? "field-disabled" : ""}>
                              Protocol
                              <select
                                value={
                                  overrides[instance.stackKey]?.protocol ||
                                  instance.existingProtocol ||
                                  instance.protocol ||
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
                                disabled={updatesBlocked}
                              >
                                <option value="">Select</option>
                                <option value="rdp">RDP</option>
                                <option value="ssh">SSH</option>
                              </select>
                            </label>
                            <label className={updatesBlocked ? "field-disabled" : ""}>
                              Quick Username
                              <select
                                value={getQuickUsernameValue(instance)}
                                onChange={(event) =>
                                  applyCredentialTemplate(instance, event.target.value)
                                }
                                disabled={updatesBlocked}
                              >
                                <option value="custom">Custom</option>
                                {getCurrentProtocol(instance) === "rdp" ? (
                                  <option value="administrator">administrator</option>
                                ) : null}
                                {getCurrentProtocol(instance) === "ssh" ? (
                                  <option value="sailpoint">sailpoint</option>
                                ) : null}
                              </select>
                            </label>
                            <label className={updatesBlocked ? "field-disabled" : ""}>
                              Username
                              <input
                                value={
                                  overrides[instance.stackKey]?.username ||
                                  instance.existingUsername ||
                                  instance.username ||
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
                                autoComplete="off"
                                disabled={updatesBlocked}
                              />
                            </label>
                          </>
                        )}
                        {(instance.needsConfig ||
                          instance.needsPassword ||
                          instance.exists) && (
                          <label className={updatesBlocked ? "field-disabled" : ""}>
                            Password
                            <span className="password-input-wrap">
                              <input
                                type={
                                  visiblePasswords[instance.stackKey] ? "text" : "password"
                                }
                                value={overrides[instance.stackKey]?.password || ""}
                                onChange={(event) =>
                                  updateOverride(
                                    instance.stackKey,
                                    "password",
                                    event.target.value,
                                    instance.imageId
                                  )
                                }
                                autoComplete="new-password"
                                placeholder={getDefaultPasswordForProtocol(
                                  getCurrentProtocol(instance)
                                )}
                                disabled={updatesBlocked}
                              />
                              <button
                                type="button"
                                className="icon-button password-toggle"
                                onClick={() => togglePasswordVisibility(instance.stackKey)}
                                aria-label={
                                  visiblePasswords[instance.stackKey]
                                    ? "Hide password"
                                    : "Show password"
                                }
                                disabled={updatesBlocked}
                              >
                                {visiblePasswords[instance.stackKey] ? (
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M3 3l18 18" />
                                    <path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" />
                                    <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5.2 0 9.3 4 10 7-.3 1.3-1.3 3-2.8 4.4" />
                                    <path d="M6.2 6.3C4.5 7.5 3.3 9.3 2 12c.7 3 4.8 7 10 7 1.4 0 2.6-.2 3.8-.7" />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                )}
                              </button>
                            </span>
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
                  );
                })}
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
              {assignedUsers.length > 0 && (
                <div className="existing-users">
                  <span className="pill ok">Existing users</span>
                  {assignedUsers.map((user) => (
                    <span key={user} className="user-chip" title={user}>
                      {user}
                    </span>
                  ))}
                </div>
              )}
              {isAuthenticated && (
                <div className="password-row">
                  <span className="password-label">Initial password</span>
                  <span className="password-value" aria-live="polite">
                    {showInitialPassword ? initialUserPassword : "••••••••"}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowInitialPassword((prev) => !prev)}
                    aria-label={showInitialPassword ? "Hide password" : "Show password"}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                      <circle cx="12" cy="12" r="3.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={handleCopyInitialPassword}
                    aria-label="Copy password"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="8" y="8" width="12" height="12" rx="2" />
                      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="button-row">
                <button className="primary" type="button" onClick={handleAddUsers}>
                  {userState === "loading" ? "Updating..." : "Add Users"}
                </button>
              </div>
              {emailDraft && (
                <div className="email-draft-card">
                  <div className="email-draft-header">
                    <div>
                      <span className="pill ok">Email Draft</span>
                      <div className="email-draft-title">User handoff message</div>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleCopyEmailDraft}
                    >
                      Copy Email
                    </button>
                  </div>
                  <p>
                    Generated from the tenant name and the users added in this step. Paste
                    this into your email client and edit if needed.
                  </p>
                  <textarea
                    className="email-draft-output"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    spellCheck="false"
                  />
                </div>
              )}
            </div>
          </section>

          <div className="toast-shell">
            {!statusMinimized && errorQueue.length > 0 && (
              <div className={`toast-stack${stackPulse ? " pulse" : ""}`} aria-live="polite">
                {errorQueue.map((item) => (
                  <div
                    key={item.id}
                    className={`toast-card${item.kind === "ok" ? " ok" : ""}${
                      item.fading ? " fading" : ""
                    }${item.fresh ? " fresh" : ""}`}
                  >
                    <span className={`pill ${item.kind === "ok" ? "ok" : "bad"}`}>
                      {item.kind === "ok" ? "OK" : "Error"}
                    </span>
                    <div className="error-message" title={item.message}>
                      {item.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!statusMinimized &&
              errorQueue.length === 0 &&
              showHistory &&
              errorHistory.length > 0 && (
                <div className="toast-stack" aria-live="off">
                  {errorHistory.map((item) => (
                    <div key={item.id} className={`toast-card${item.kind === "ok" ? " ok" : ""}`}>
                      <span className={`pill ${item.kind === "ok" ? "ok" : "bad"}`}>
                        {item.kind === "ok" ? "OK" : "Error"}
                      </span>
                      <div className="error-message" title={item.message}>
                        {item.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            <button
              type="button"
              className={`status-toggle${errorHistory.length > 0 ? " has-alert" : ""}`}
              onClick={() =>
                setStatusMinimized((prev) => {
                  const next = !prev;
                  if (!next) {
                    setShowHistory(true);
                  }
                  return next;
                })
              }
              aria-label={statusMinimized ? "Show alerts" : "Hide alerts"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v3.1l-1.6 2.9a1 1 0 0 0 .9 1.5h14.4a1 1 0 0 0 .9-1.5l-1.6-2.9V9a6.5 6.5 0 0 0-6.5-6.5z" />
                <path d="M9.2 18.5a2.8 2.8 0 0 0 5.6 0" />
                <path d="M5.2 8.2c.4-2.6 2.4-4.7 5-5.2" />
                <path d="M18.8 8.2c-.4-2.6-2.4-4.7-5-5.2" />
              </svg>
              {errorHistory.length > 0 && (
                <span className="status-badge danger">
                  {Math.min(errorHistory.length, 9)}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
