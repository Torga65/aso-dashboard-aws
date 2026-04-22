"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
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

  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  // Build the self-contained bookmarklet code string with this origin baked in
  const bookmarkletCode = useMemo(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    return `(function(){if(document.getElementById('_aso_bm'))return;var D='${origin}';var title='';var h1=document.querySelector('h1');if(h1)title=h1.textContent.trim();if(!title)title=document.title.replace(/\\s*[-|]\\s*Microsoft Teams.*/i,'').trim();var today=new Date().toISOString().slice(0,10);var el=document.createElement('div');el.id='_aso_bm';el.style.cssText='position:fixed;top:20px;right:20px;width:340px;background:#fff;border:1px solid #ddd;border-radius:10px;padding:20px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;color:#333';el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><strong style="font-size:15px">Upload to ASO Dashboard</strong><button id="_aso_x" style="background:none;border:none;cursor:pointer;font-size:20px;color:#999;line-height:1">&#x2715;</button></div><div style="display:flex;flex-direction:column;gap:10px"><div><label style="font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.04em">Meeting title</label><input id="_aso_ttl" style="width:100%;box-sizing:border-box;margin-top:3px;padding:6px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px" /></div><div><label style="font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.04em">Customer name</label><input id="_aso_co" style="width:100%;box-sizing:border-box;margin-top:3px;padding:6px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px" placeholder="e.g. Adobe Acrobat" /></div><div><label style="font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.04em">Meeting date</label><input id="_aso_dt" type="date" style="width:100%;box-sizing:border-box;margin-top:3px;padding:6px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px" /></div><div><label style="font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.04em">VTT transcript file</label><input id="_aso_f" type="file" accept=".vtt,.txt" style="margin-top:3px;font-size:13px;width:100%" /></div><div><label style="font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.04em">Your email</label><input id="_aso_em" style="width:100%;box-sizing:border-box;margin-top:3px;padding:6px 8px;border:1px solid #ddd;border-radius:5px;font-size:13px" placeholder="you@adobe.com" /></div><div id="_aso_msg" style="font-size:12px;min-height:16px"></div><button id="_aso_go" style="background:#667eea;color:#fff;border:none;border-radius:6px;padding:9px 16px;cursor:pointer;font-size:13px;font-weight:500;width:100%">Upload Transcript</button></div>';document.body.appendChild(el);document.getElementById('_aso_ttl').value=title;document.getElementById('_aso_dt').value=today;var saved=localStorage.getItem('_aso_em')||'';if(saved)document.getElementById('_aso_em').value=saved;document.getElementById('_aso_x').onclick=function(){el.remove();};document.getElementById('_aso_go').onclick=function(){var t=document.getElementById('_aso_ttl').value.trim();var co=document.getElementById('_aso_co').value.trim();var dt=document.getElementById('_aso_dt').value.trim();var em=document.getElementById('_aso_em').value.trim();var fi=document.getElementById('_aso_f').files[0];var msg=document.getElementById('_aso_msg');var btn=document.getElementById('_aso_go');if(!co||!dt||!fi){msg.style.color='#dc2626';msg.textContent='Customer name, date and file are required.';return;}if(em)localStorage.setItem('_aso_em',em);btn.textContent='Uploading\u2026';btn.disabled=true;var r=new FileReader();r.onload=function(e){fetch(D+'/api/teams/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({meetingTitle:t,companyName:co,meetingDate:dt,content:e.target.result,uploadedBy:em,fileName:fi.name})}).then(function(res){return res.json();}).then(function(d){if(d.error)throw new Error(d.error);msg.style.color='#16a34a';msg.textContent='\u2713 Uploaded!';btn.textContent='Done \u2713';setTimeout(function(){el.remove();},1800);}).catch(function(err){msg.style.color='#dc2626';msg.textContent=err.message||'Upload failed.';btn.textContent='Upload Transcript';btn.disabled=false;});};r.readAsText(fi);};})()`;
  }, []);

  // React sanitises javascript: hrefs — set it imperatively on the DOM element
  useEffect(() => {
    if (bookmarkletRef.current && bookmarkletCode) {
      bookmarkletRef.current.setAttribute("href", "javascript:" + encodeURIComponent(bookmarkletCode));
    }
  }, [bookmarkletCode]);

  // Run the overlay directly when clicked (preview + actual use on Teams)
  function handleBookmarkletClick(e: React.MouseEvent) {
    e.preventDefault();
    if (bookmarkletCode) {
      // eslint-disable-next-line no-new-func
      new Function(bookmarkletCode.slice(1, -3) + "}")();
    }
  }

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

        {/* Add form */}
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

        {/* Table */}
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

      <hr style={styles.divider} />

      {/* Bookmarklet */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={styles.cardHeading}>Browser Bookmarklet</h2>
        <p style={styles.metaText}>
          Upload a transcript from Teams in two clicks — no admin permissions required.
          After a meeting, download the VTT file from Teams, then click the bookmarklet
          to send it straight to the dashboard.
        </p>

        {/* Drag target */}
        <div style={styles.bookmarkletBox}>
          <a
            href={bookmarkletHref}
            style={styles.bookmarkletLink}
            draggable
          >
            📋 Upload to ASO Dashboard
          </a>
          <p style={{ ...styles.metaText, marginTop: 10 }}>
            <strong>Step 1:</strong> Drag this button to your browser bookmarks bar.<br />
            <strong>Step 2:</strong> After a Teams meeting, open the recap in{" "}
            <strong>teams.microsoft.com</strong>, download the transcript (.vtt), then click
            the bookmark to upload it.
          </p>
          <p style={{ ...styles.metaText, fontStyle: "italic" }}>
            You can click it here to preview the upload form.
          </p>
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ ...styles.metaText, fontWeight: 600, color: "var(--text-body)" }}>How to use:</p>
          <ol style={{ ...styles.metaText, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 5, margin: 0 }}>
            <li>Open the meeting recap in <strong>Teams web</strong> (teams.microsoft.com)</li>
            <li>Click <strong>Download transcript</strong> to save the .vtt file</li>
            <li>Click <strong>Upload to ASO Dashboard</strong> in your bookmarks bar</li>
            <li>Fill in the customer name, confirm the date, select the file → <strong>Upload</strong></li>
          </ol>
        </div>
      </section>
    </div>
  );
}

// ─── Inline styles ────────────────────────────────────────────────────────────

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
  bookmarkletBox: {
    background: "var(--surface-alt)",
    border: "2px dashed var(--border-color)",
    borderRadius: 10,
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: 4,
  },
  bookmarkletLink: {
    display: "inline-block",
    padding: "9px 18px",
    background: "#667eea",
    color: "#fff",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    textDecoration: "none",
    cursor: "grab",
    userSelect: "none" as const,
    boxShadow: "0 2px 8px rgba(102,126,234,.35)",
  },
};

export default function TeamsSettingsPage() {
  return (
    <Suspense>
      <TeamsSettingsInner />
    </Suspense>
  );
}
