"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useIMSAuth } from "@/contexts/IMSAuthContext";
import { useSearchParams } from "next/navigation";

interface Mapping {
  id: string;
  keyword: string;
  companyName: string;
}

interface ConnectionStatus {
  connected: boolean;
  msEmail?: string;
  connectedAt?: string;
}

function TeamsSettingsInner() {
  const { profile, isAuthenticated } = useIMSAuth();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [adding, setAdding] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const userId = profile?.userId ?? "";

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected === "1") setToast({ type: "success", message: "Microsoft Teams connected successfully." });
    if (error) setToast({ type: "error", message: decodeURIComponent(error).replace(/_/g, " ") });
  }, [searchParams]);

  const fetchStatus = useCallback(async () => {
    if (!userId) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/teams/status?userId=${encodeURIComponent(userId)}`);
      setStatus(await res.json() as ConnectionStatus);
    } catch {
      setStatus({ connected: false });
    } finally {
      setStatusLoading(false);
    }
  }, [userId]);

  const fetchMappings = useCallback(async () => {
    if (!userId) return;
    setMappingsLoading(true);
    try {
      const res = await fetch(`/api/teams/mappings?userId=${encodeURIComponent(userId)}`);
      const json = await res.json() as { data: Mapping[] };
      setMappings(json.data ?? []);
    } catch {
      setMappings([]);
    } finally {
      setMappingsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      void fetchStatus();
      void fetchMappings();
    }
  }, [userId, fetchStatus, fetchMappings]);

  function handleConnect() {
    if (!userId) return;
    window.location.href = `/api/teams/auth?userId=${encodeURIComponent(userId)}`;
  }

  async function handleDisconnect() {
    if (!userId) return;
    setDisconnecting(true);
    try {
      await fetch(`/api/teams/disconnect?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
      setStatus({ connected: false });
      setToast({ type: "success", message: "Disconnected from Microsoft Teams." });
    } catch {
      setToast({ type: "error", message: "Failed to disconnect. Try again." });
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleAddMapping() {
    if (!userId || !newKeyword.trim() || !newCompany.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/teams/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, keyword: newKeyword.trim(), companyName: newCompany.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      setNewKeyword("");
      setNewCompany("");
      await fetchMappings();
      setToast({ type: "success", message: "Mapping added." });
    } catch {
      setToast({ type: "error", message: "Failed to add mapping. Try again." });
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteMapping(id: string) {
    try {
      await fetch(`/api/teams/mappings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setToast({ type: "error", message: "Failed to delete mapping." });
    }
  }

  if (!isAuthenticated) {
    return (
      <div style={styles.page}>
        <p style={{ color: "var(--text-muted)" }}>Please sign in to manage your Teams integration.</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Microsoft Teams Integration</h1>
      <p style={styles.subtext}>
        Connect your Microsoft account so the dashboard automatically imports transcripts from
        your Teams meetings into the Meeting Transcripts table — no manual uploads needed.
      </p>

      {toast && (
        <div style={{ ...styles.toast, ...(toast.type === "error" ? styles.toastError : styles.toastSuccess) }}>
          {toast.message}
          <button style={styles.toastClose} onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* Connection card */}
      <section style={styles.card}>
        <h2 style={styles.cardHeading}>Connection Status</h2>

        {statusLoading ? (
          <p style={{ color: "var(--text-muted)" }}>Checking…</p>
        ) : status?.connected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={styles.badgeConnected}>Connected</span>
              <span style={{ color: "var(--text-body)" }}>{status.msEmail}</span>
            </div>
            {status.connectedAt && (
              <p style={styles.metaText}>
                Connected {new Date(status.connectedAt).toLocaleDateString()}
              </p>
            )}
            <button
              style={{ ...styles.btn, ...styles.btnDanger }}
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={styles.badgeNeutral}>Not connected</span>
            </div>
            <p style={styles.metaText}>
              Click Connect to authorize read-only access to your Teams meeting transcripts.
              You will be redirected to Microsoft to sign in and consent.
            </p>
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleConnect}>
              Connect Microsoft Teams
            </button>
          </div>
        )}
      </section>

      <hr style={styles.divider} />

      {/* Mappings */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={styles.cardHeading}>Meeting → Customer Mappings</h2>
        <p style={styles.metaText}>
          The sync checks your meeting titles for these keywords (case-insensitive) and links
          the transcript to the matching customer. First match wins.
        </p>

        <div style={styles.addRow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={styles.inputLabel}>Meeting title keyword</label>
            <input
              style={styles.input}
              type="text"
              placeholder='e.g. "Acrobat" or "Adobe Sign"'
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={styles.inputLabel}>Customer name (exact match)</label>
            <input
              style={styles.input}
              type="text"
              placeholder="Must match a customer in the dashboard"
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
            />
          </div>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary, alignSelf: "flex-end" }}
            onClick={() => void handleAddMapping()}
            disabled={adding || !newKeyword.trim() || !newCompany.trim()}
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {mappingsLoading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading…</p>
        ) : mappings.length === 0 ? (
          <div style={styles.emptyState}>
            No mappings yet. Add one above to start syncing transcripts.
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Keyword</th>
                <th style={styles.th}>Customer</th>
                <th style={{ ...styles.th, width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} style={styles.tr}>
                  <td style={styles.td}>{m.keyword}</td>
                  <td style={styles.td}>{m.companyName}</td>
                  <td style={styles.td}>
                    <button
                      style={styles.deleteBtn}
                      onClick={() => void handleDeleteMapping(m.id)}
                      aria-label="Delete mapping"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 780,
    margin: "0 auto",
    padding: "40px 24px 80px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    fontFamily: "var(--body-font-family)",
    color: "var(--text-body)",
  },
  heading: {
    fontSize: "var(--heading-font-size-m)",
    fontFamily: "var(--heading-font-family)",
    color: "var(--text-strong)",
    margin: 0,
  },
  subtext: {
    fontSize: 14,
    color: "var(--text-muted)",
    margin: 0,
    lineHeight: 1.6,
  },
  metaText: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: 0,
    lineHeight: 1.6,
  },
  toast: {
    padding: "12px 16px",
    borderRadius: 8,
    fontSize: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  toastSuccess: {
    background: "var(--status-active-bg)",
    color: "var(--status-active-text)",
    border: "1px solid #bbf7d0",
  },
  toastError: {
    background: "var(--status-churned-bg)",
    color: "var(--status-churned-text)",
    border: "1px solid #fecaca",
  },
  toastClose: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    color: "inherit",
    padding: 0,
  },
  card: {
    background: "var(--surface-alt)",
    border: "1px solid var(--border-color)",
    borderRadius: 10,
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text-strong)",
    margin: 0,
    fontFamily: "var(--heading-font-family)",
  },
  badgeConnected: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--status-active-bg)",
    color: "var(--status-active-text)",
  },
  badgeNeutral: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--light-color)",
    color: "var(--dark-color)",
  },
  btn: {
    padding: "8px 16px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    width: "fit-content",
  },
  btnPrimary: {
    background: "#667eea",
    color: "#fff",
  },
  btnDanger: {
    background: "transparent",
    color: "var(--status-churned-text)",
    border: "1px solid var(--status-churned-text)",
  },
  divider: {
    border: "none",
    borderTop: "1px solid var(--border-color)",
    margin: 0,
  },
  addRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  },
  input: {
    padding: "7px 10px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    fontSize: 13,
    background: "var(--surface-color)",
    color: "var(--text-body)",
    width: 240,
    outline: "none",
  },
  table: {
    width: "100%",
    maxWidth: 600,
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: "2px solid var(--border-color)",
    fontWeight: 600,
    color: "var(--text-muted)",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  td: {
    padding: "9px 12px",
    borderBottom: "1px solid var(--border-color)",
    color: "var(--text-body)",
  },
  tr: {},
  emptyState: {
    padding: "16px",
    background: "var(--surface-alt)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    fontSize: 13,
    color: "var(--text-muted)",
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
    fontSize: 14,
    padding: "2px 6px",
    borderRadius: 4,
  },
};

export default function TeamsSettingsPage() {
  return (
    <Suspense>
      <TeamsSettingsInner />
    </Suspense>
  );
}
