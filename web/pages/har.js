import { useEffect, useMemo, useState } from "react";
import Nav from "../components/Nav";

function formatBytes(value) {
  if (!Number.isFinite(value)) return "0 B";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "0 ms";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function safeGet(obj, path, fallback) {
  return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ??
    fallback;
}

function summarizeEntries(entries) {
  if (!entries.length) {
    return {
      totalRequests: 0,
      totalBytes: 0,
      totalTime: 0,
      hosts: [],
    };
  }

  const times = entries.map((entry) => new Date(entry.startedDateTime).getTime());
  const start = Math.min(...times);
  const end = Math.max(
    ...entries.map((entry) => new Date(entry.startedDateTime).getTime() + (entry.time || 0))
  );
  const totalBytes = entries.reduce((sum, entry) => sum + (entry.response?.bodySize || 0), 0);

  const hostMap = new Map();
  entries.forEach((entry) => {
    const url = safeGet(entry, ["request", "url"], "");
    try {
      const host = new URL(url).host;
      hostMap.set(host, (hostMap.get(host) || 0) + 1);
    } catch (err) {
      // ignore invalid urls
    }
  });

  const hosts = Array.from(hostMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([host, count]) => ({ host, count }));

  return {
    totalRequests: entries.length,
    totalBytes,
    totalTime: Math.max(0, end - start),
    hosts,
  };
}

function analyzeIssues(entries) {
  const issues = [];
  const slowThreshold = 2000;
  const largeThreshold = 1024 * 1024;

  entries.forEach((entry) => {
    const url = safeGet(entry, ["request", "url"], "");
    const method = safeGet(entry, ["request", "method"], "");
    const status = safeGet(entry, ["response", "status"], 0);
    const time = entry.time || 0;
    const bodySize = entry.response?.bodySize || 0;
    const cacheHeader = entry.response?.headers?.find(
      (header) => header.name.toLowerCase() === "cache-control"
    );

    if (status >= 400) {
      issues.push({
        type: "error",
        title: `${status} response`,
        detail: `${method} ${url}`,
      });
    }

    if (time > slowThreshold) {
      issues.push({
        type: "warn",
        title: "Slow request",
        detail: `${formatMs(time)} for ${method} ${url}`,
      });
    }

    if (bodySize > largeThreshold) {
      issues.push({
        type: "warn",
        title: "Large payload",
        detail: `${formatBytes(bodySize)} from ${method} ${url}`,
      });
    }

    if (url.startsWith("http://")) {
      issues.push({
        type: "warn",
        title: "Insecure request",
        detail: `${method} ${url}`,
      });
    }

    const isAsset =
      url.endsWith(".js") ||
      url.endsWith(".css") ||
      url.endsWith(".png") ||
      url.endsWith(".jpg") ||
      url.endsWith(".jpeg") ||
      url.endsWith(".svg") ||
      url.endsWith(".woff2");
    if (isAsset && !cacheHeader) {
      issues.push({
        type: "hint",
        title: "Missing cache control",
        detail: `${method} ${url}`,
      });
    }
  });

  return issues.slice(0, 40);
}

export default function HarPage() {
  const [harName, setHarName] = useState("");
  const [harData, setHarData] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [error, setError] = useState("");

  const entries = useMemo(() => {
    const list = harData?.log?.entries || [];
    return Array.isArray(list) ? list : [];
  }, [harData]);

  const domains = useMemo(() => {
    const set = new Set();
    entries.forEach((entry) => {
      const url = safeGet(entry, ["request", "url"], "");
      try {
        set.add(new URL(url).host);
      } catch (err) {
        // ignore invalid urls
      }
    });
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const status = safeGet(entry, ["response", "status"], 0);
      const url = safeGet(entry, ["request", "url"], "");
      let domainMatch = true;

      if (domainFilter !== "all") {
        try {
          domainMatch = new URL(url).host === domainFilter;
        } catch (err) {
          domainMatch = false;
        }
      }

      if (!domainMatch) return false;

      if (statusFilter === "4xx") return status >= 400 && status < 500;
      if (statusFilter === "5xx") return status >= 500;
      if (statusFilter === "errors") return status >= 400;
      return true;
    });
  }, [entries, statusFilter, domainFilter]);

  const summary = useMemo(() => summarizeEntries(entries), [entries]);
  const issues = useMemo(() => analyzeIssues(filteredEntries), [filteredEntries]);
  const selectedEntry = filteredEntries[selectedIndex];

  const criticalPath = useMemo(() => {
    return [...filteredEntries]
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 6);
  }, [filteredEntries]);

  const waterfall = useMemo(() => {
    if (!filteredEntries.length) {
      return { start: 0, end: 0, span: 0, items: [] };
    }

    const startedTimes = filteredEntries.map((entry) =>
      new Date(entry.startedDateTime).getTime()
    );
    const start = Math.min(...startedTimes);
    const end = Math.max(
      ...filteredEntries.map((entry) => new Date(entry.startedDateTime).getTime() + (entry.time || 0))
    );
    const span = Math.max(1, end - start);

    const items = filteredEntries.map((entry) => {
      const entryStart = new Date(entry.startedDateTime).getTime();
      const offset = ((entryStart - start) / span) * 100;
      const width = ((entry.time || 0) / span) * 100;
      return {
        entry,
        offset,
        width: Math.max(width, 0.6),
      };
    });

    return { start, end, span, items };
  }, [filteredEntries]);

  useEffect(() => {
    if (selectedIndex >= filteredEntries.length) {
      setSelectedIndex(0);
    }
  }, [filteredEntries, selectedIndex]);

  function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setHarName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed?.log?.entries) {
          throw new Error("Not a valid HAR file.");
        }
        setHarData(parsed);
        setSelectedIndex(0);
      } catch (err) {
        setError(err.message);
        setHarData(null);
      }
    };
    reader.onerror = () => {
      setError("Failed to read the file.");
    };
    reader.readAsText(file);
  }

  return (
    <main>
      <Nav />
      <div className="container">
        <div className="hero">
          <h1>HAR Inspector</h1>
          <p>
            Upload a HAR file, review detailed requests, and get a quick analysis of
            request flow and potential issues.
          </p>
          <div className="tag">
            Offline analysis <span aria-hidden="true">•</span> No data leaves this page
          </div>
        </div>

        <section className="panel">
          <h2>Upload HAR</h2>
          <p>Drop a DevTools HAR export to start the analysis.</p>
          <div className="fields">
            <input type="file" accept=".har,application/json" onChange={handleFileUpload} />
            {harName && (
              <div className="status">
                <span className="pill ok">Loaded</span> {harName}
              </div>
            )}
            {error && (
              <div className="status">
                <span className="pill bad">Error</span> {error}
              </div>
            )}
          </div>
        </section>

        <div className="grid">
          <section className="panel">
            <h2>Flow Summary</h2>
            <p>High-level shape of the network activity.</p>
            <div className="list">
              <div className="list-item">
                <h3>{summary.totalRequests} requests</h3>
                <small>Total transfer: {formatBytes(summary.totalBytes)}</small>
              </div>
              <div className="list-item">
                <h3>{formatMs(summary.totalTime)} total duration</h3>
                <small>Span between first and last request</small>
              </div>
              <div className="list-item">
                <h3>Top hosts</h3>
                {summary.hosts.length ? (
                  summary.hosts.map((host) => (
                    <div key={host.host} className="status">
                      <span className="pill warn">{host.count}</span> {host.host}
                    </div>
                  ))
                ) : (
                  <div className="status">No host data yet.</div>
                )}
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Filters</h2>
            <p>Slice by status code family or domain.</p>
            <div className="fields">
              <div className="row">
                <label>
                  Status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="errors">Errors (4xx/5xx)</option>
                    <option value="4xx">4xx only</option>
                    <option value="5xx">5xx only</option>
                  </select>
                </label>
                <label>
                  Domain
                  <select
                    value={domainFilter}
                    onChange={(event) => setDomainFilter(event.target.value)}
                  >
                    {domains.map((domain) => (
                      <option key={domain} value={domain}>
                        {domain === "all" ? "All domains" : domain}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="status">
                <span className="pill ok">{filteredEntries.length}</span> showing /
                <span className="pill warn">{entries.length}</span> total
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Potential Issues</h2>
            <p>Heuristics-based hints to investigate.</p>
            {!issues.length ? (
              <div className="status">No obvious issues detected.</div>
            ) : (
              <div className="list">
                {issues.map((issue, index) => (
                  <div className="list-item" key={`${issue.title}-${index}`}>
                    <div className={`pill ${issue.type === "error" ? "bad" : "warn"}`}>
                      {issue.type.toUpperCase()}
                    </div>
                    <h3>{issue.title}</h3>
                    <small>{issue.detail}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="panel">
          <h2>Critical Path</h2>
          <p>Top requests by duration inside the current filter.</p>
          {!criticalPath.length ? (
            <div className="status">No requests loaded yet.</div>
          ) : (
            <div className="list">
              {criticalPath.map((entry, index) => (
                <div className="list-item" key={`${entry.request?.url}-${index}`}>
                  <h3>{formatMs(entry.time || 0)}</h3>
                  <small>
                    {safeGet(entry, ["request", "method"], "")}{" "}
                    {safeGet(entry, ["request", "url"], "")}
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Waterfall Timeline</h2>
          <p>Relative timing across the filtered requests.</p>
          {!waterfall.items.length ? (
            <div className="status">No requests loaded yet.</div>
          ) : (
            <div className="waterfall">
              <div className="waterfall-scale">
                <span>Start</span>
                <span>{formatMs(waterfall.span)}</span>
              </div>
              <div className="waterfall-list">
                {waterfall.items.map((item, index) => {
                  const url = safeGet(item.entry, ["request", "url"], "");
                  const method = safeGet(item.entry, ["request", "method"], "");
                  const status = safeGet(item.entry, ["response", "status"], 0);
                  return (
                    <button
                      type="button"
                      className="waterfall-row"
                      key={`${url}-${index}`}
                      onClick={() => setSelectedIndex(index)}
                    >
                      <div className="waterfall-label">
                        <span className="pill warn">{method}</span>
                        <span className={`pill ${status >= 400 ? "bad" : "ok"}`}>
                          {status}
                        </span>
                        <span className="waterfall-url">{url}</span>
                      </div>
                      <div className="waterfall-bar">
                        <div
                          className={`waterfall-bar-fill ${
                            status >= 500 ? "fail" : status >= 400 ? "warn" : "ok"
                          }`}
                          style={{
                            marginLeft: `${item.offset}%`,
                            width: `${item.width}%`,
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Request Details</h2>
          <p>Click an entry to see headers, timings, and payload size.</p>
          {!filteredEntries.length ? (
            <div className="status">No requests loaded yet.</div>
          ) : (
            <div className="har-grid">
              <div className="har-list">
                {filteredEntries.map((entry, index) => {
                  const url = safeGet(entry, ["request", "url"], "");
                  const status = safeGet(entry, ["response", "status"], "-");
                  const method = safeGet(entry, ["request", "method"], "");
                  const time = entry.time || 0;
                  return (
                    <button
                      key={`${url}-${index}`}
                      className={index === selectedIndex ? "har-item active" : "har-item"}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                    >
                      <div className="har-title">
                        <span className="pill warn">{method}</span>
                        <span className={`pill ${status >= 400 ? "bad" : "ok"}`}>
                          {status}
                        </span>
                        <span>{formatMs(time)}</span>
                      </div>
                      <div className="har-url">{url}</div>
                    </button>
                  );
                })}
              </div>
              <div className="har-detail">
                {selectedEntry ? (
                  <>
                    <h3>Selected Request</h3>
                    <div className="status">
                      <strong>URL:</strong> {safeGet(selectedEntry, ["request", "url"], "")}
                    </div>
                    <div className="status">
                      <strong>Status:</strong>{" "}
                      {safeGet(selectedEntry, ["response", "status"], "-")}
                    </div>
                    <div className="status">
                      <strong>Method:</strong>{" "}
                      {safeGet(selectedEntry, ["request", "method"], "")}
                    </div>
                    <div className="status">
                      <strong>Transfer:</strong>{" "}
                      {formatBytes(selectedEntry.response?.bodySize || 0)}
                    </div>
                    <div className="status">
                      <strong>Timing:</strong> {formatMs(selectedEntry.time || 0)}
                    </div>
                    <div className="list" style={{ marginTop: 14 }}>
                      <div className="list-item">
                        <h3>Request Headers</h3>
                        <small>
                          {(selectedEntry.request?.headers || [])
                            .map((header) => `${header.name}: ${header.value}`)
                            .join("\n") || "None"}
                        </small>
                      </div>
                      <div className="list-item">
                        <h3>Response Headers</h3>
                        <small>
                          {(selectedEntry.response?.headers || [])
                            .map((header) => `${header.name}: ${header.value}`)
                            .join("\n") || "None"}
                        </small>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="status">Select a request to see details.</div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
