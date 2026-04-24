"use client";

import { useState, useEffect, useRef } from "react";
import StaticPageFrame from "@/components/layout/StaticPageFrame";
import { useIMSAuth } from "@/contexts/IMSAuthContext";

interface Customer { companyName: string; }

export default function CustomerHistoryPage() {
  const { profile } = useIMSAuth();
  const [modalOpen, setModalOpen]     = useState(false);
  const [customers, setCustomers]     = useState<string[]>([]);
  const [company, setCompany]         = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [file, setFile]               = useState<File | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [result, setResult]           = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load customer names once for the datalist
  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((json: { data?: Customer[] }) => {
        const names = [...new Set((json.data ?? []).map((c) => c.companyName))].sort();
        setCustomers(names);
      })
      .catch(() => {});
  }, []);

  function openModal() {
    setCompany("");
    setMeetingDate(new Date().toISOString().slice(0, 10));
    setFile(null);
    setResult(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (uploading) return;
    setModalOpen(false);
  }

  async function handleUpload() {
    if (!company.trim() || !meetingDate || !file) return;
    setUploading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("company",     company.trim());
      form.append("meetingDate", meetingDate);
      form.append("fileType",    "transcript");
      form.append("uploadedBy",  profile?.email ?? "");
      form.append("file",        file);

      const res  = await fetch("/api/transcripts", { method: "POST", body: form });
      const json = await res.json() as { error?: string };

      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setResult({ ok: true, msg: "Transcript uploaded successfully." });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      // Tell the iframe to refresh the transcript panel for this company, then close
      const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage(
        { type: "aso:transcriptUploaded", companyName: company.trim() },
        window.location.origin
      );
      setTimeout(() => setModalOpen(false), 1500);
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <StaticPageFrame src="/customer-history.html" title="Customer 360" />

      {/* Floating upload button */}
      <button style={s.fab} onClick={openModal} title="Upload transcript">
        + Upload Transcript
      </button>

      {/* Modal */}
      {modalOpen && (
        <div style={s.backdrop} onClick={closeModal}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Upload Meeting Transcript</span>
              <button style={s.closeBtn} onClick={closeModal}>✕</button>
            </div>

            <div style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Customer name</label>
                <input
                  style={s.input}
                  list="customer-list"
                  placeholder="Start typing a customer name…"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  autoFocus
                />
                <datalist id="customer-list">
                  {customers.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>

              <div style={s.field}>
                <label style={s.label}>Meeting date</label>
                <input
                  style={s.input}
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </div>

              <div style={s.field}>
                <label style={s.label}>Transcript file (.vtt)</label>
                <input
                  ref={fileRef}
                  style={s.fileInput}
                  type="file"
                  accept=".vtt,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {result && (
                <p style={{ ...s.resultMsg, color: result.ok ? "var(--status-active-text)" : "var(--status-churned-text)" }}>
                  {result.ok ? "✓ " : "✗ "}{result.msg}
                </p>
              )}

              <div style={s.actions}>
                <button style={s.cancelBtn} onClick={closeModal} disabled={uploading}>
                  Cancel
                </button>
                <button
                  style={{ ...s.uploadBtn, opacity: (!company.trim() || !meetingDate || !file || uploading) ? 0.5 : 1 }}
                  onClick={() => void handleUpload()}
                  disabled={!company.trim() || !meetingDate || !file || uploading}
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  fab: {
    position:     "fixed",
    top:          76,   // just below the 64px nav
    right:        24,
    zIndex:       50,
    padding:      "8px 16px",
    background:   "#667eea",
    color:        "#fff",
    border:       "none",
    borderRadius: 8,
    fontSize:     13,
    fontWeight:   600,
    cursor:       "pointer",
    boxShadow:    "0 2px 10px rgba(102,126,234,.4)",
  },
  backdrop: {
    position:       "fixed",
    inset:          0,
    background:     "rgba(0,0,0,.45)",
    zIndex:         200,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
  },
  modal: {
    background:   "var(--background-color, #fff)",
    border:       "1px solid var(--border-color, #e5e7eb)",
    borderRadius: 12,
    width:        440,
    maxWidth:     "calc(100vw - 32px)",
    boxShadow:    "0 8px 32px rgba(0,0,0,.2)",
    overflow:     "hidden",
  },
  modalHeader: {
    display:        "flex",
    justifyContent: "space-between",
    alignItems:     "center",
    padding:        "16px 20px",
    borderBottom:   "1px solid var(--border-color, #e5e7eb)",
  },
  modalTitle: {
    fontWeight:  600,
    fontSize:    15,
    color:       "var(--text-strong, #111)",
    fontFamily:  "var(--heading-font-family)",
  },
  closeBtn: {
    background: "transparent",
    border:     "none",
    cursor:     "pointer",
    fontSize:   18,
    color:      "var(--text-muted, #6b7280)",
    padding:    "0 2px",
    lineHeight: 1,
  },
  form: {
    display:       "flex",
    flexDirection: "column",
    gap:           16,
    padding:       "20px",
  },
  field: {
    display:       "flex",
    flexDirection: "column",
    gap:           5,
  },
  label: {
    fontSize:    12,
    fontWeight:  600,
    color:       "var(--text-muted, #6b7280)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: {
    padding:      "8px 10px",
    border:       "1px solid var(--border-color, #e5e7eb)",
    borderRadius: 6,
    fontSize:     13,
    background:   "var(--surface-color, #fff)",
    color:        "var(--text-body, #374151)",
    outline:      "none",
    width:        "100%",
    boxSizing:    "border-box",
  },
  fileInput: {
    fontSize: 13,
    color:    "var(--text-body, #374151)",
  },
  resultMsg: {
    fontSize: 13,
    margin:   0,
  },
  actions: {
    display:        "flex",
    justifyContent: "flex-end",
    gap:            10,
    paddingTop:     4,
  },
  cancelBtn: {
    padding:      "8px 16px",
    background:   "transparent",
    border:       "1px solid var(--border-color, #e5e7eb)",
    borderRadius: 6,
    fontSize:     13,
    cursor:       "pointer",
    color:        "var(--text-body, #374151)",
  },
  uploadBtn: {
    padding:      "8px 20px",
    background:   "#667eea",
    color:        "#fff",
    border:       "none",
    borderRadius: 6,
    fontSize:     13,
    fontWeight:   600,
    cursor:       "pointer",
  },
};
