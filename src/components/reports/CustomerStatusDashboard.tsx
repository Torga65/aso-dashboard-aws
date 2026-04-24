"use client";

import { useState, useMemo, useEffect } from "react";

// ─── Theme tokens ─────────────────────────────────────────────────────────────
const T = {
  bg: "#f8f8f8", surface: "#ffffff", surfaceSecondary: "#f5f5f5",
  border: "#e1e1e1", borderStrong: "#cacaca",
  text: "#2c2c2c", textSecondary: "#6e6e6e", textTertiary: "#b0b0b0",
  adobeRed: "#eb1000", blue: "#1473e6", blueLight: "#e8f0fd",
  green: "#12805c", greenLight: "#edfaf4",
  orange: "#cb6f10", orangeLight: "#fff5e0",
  purple: "#7e4af2", purpleLight: "#f0ebff",
  red: "#d7373f", redLight: "#fff0ee",
  gray: "#6e6e6e", grayLight: "#f0f0f0",
};

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_OPTIONS   = ["Prod", "POC", "Preprod", "On Hold - Future Date", "On Hold - Migration"] as const;
const MIGRATION_TYPES  = ["", "On Prem - AEM", "On Prem - Not AEM", "AMS", "AEMaaCS", "EDS"] as const;
const MIGRATION_PATHS  = ["", "AMS > AEMaaCS", "On-Prem > AEMaaCS", "Non-AEM > EDS", "Non-AEM > AEMaaCS", "On-Prem > EDS"] as const;
const AUTO_OPT_STATES  = ["Not Configured", "Enabled but Incomplete", "In Progress", "Fully Operational"] as const;
const HOLD_REASONS     = ["Future Date", "On Prem - AEM Migration", "On Prem - Non-AEM Migration", "AMS Migration", "Compliance", "Org Readiness", "Other"] as const;
const ENGAGEMENT_STATES = ["Active", "Low", "At Risk", "Inactive"] as const;

type CustomerStatus  = typeof STATUS_OPTIONS[number];
type EngagementState = typeof ENGAGEMENT_STATES[number];
type AutoOptState    = typeof AUTO_OPT_STATES[number];

// ─── Auto-optimizable opportunities ──────────────────────────────────────────
const AUTO_OPT_OPPORTUNITIES = [
  {
    name: "Engagement",
    opportunities: [
      { id: "accessibility-issues",   label: "Accessibility issues" },
      { id: "broken-internal-links",  label: "Broken internal links" },
      { id: "high-traffic-low-ctr",   label: "High traffic page has low CTR" },
      { id: "missing-alt-text",       label: "Missing alt text" },
    ],
  },
  {
    name: "Traffic Acquisition",
    opportunities: [
      { id: "broken-backlinks",               label: "Broken backlinks" },
      { id: "invalid-missing-metadata",       label: "Invalid or missing metadata" },
      { id: "missing-invalid-structured-data", label: "Missing or invalid structured data" },
    ],
  },
  {
    name: "Site Health",
    opportunities: [
      { id: "core-web-vitals",              label: "Core Web Vitals" },
      { id: "security-posture",             label: "Security posture" },
      { id: "cors-configuration",           label: "CORS configuration" },
      { id: "cross-site-scripting",         label: "Cross-site scripting" },
      { id: "website-permissions",          label: "Website permissions" },
      { id: "website-vulnerabilities",      label: "Website vulnerabilities" },
      { id: "canonical-tags",               label: "Canonical tags" },
      { id: "hreflang-tags",                label: "Hreflang tags" },
      { id: "sitemap-cleanup",              label: "Sitemap cleanup" },
      { id: "structured-data-enhancement",  label: "Structured data enhancement" },
      { id: "aria-labels",                  label: "ARIA labels" },
      { id: "paid-media",                   label: "Paid media" },
    ],
  },
] as const;

const ALL_OPP_COUNT = AUTO_OPT_OPPORTUNITIES.reduce((s, c) => s + c.opportunities.length, 0);

type OppState = { enabled: boolean; used: boolean };

interface Customer {
  id: string;
  name: string;
  status: CustomerStatus;
  engagement: EngagementState;
  autoOpt: AutoOptState;
  migration: string;
  migrationPath: string;
  holdReason: string;
  holdDate: string;
  notes: string;
  enabledOpportunities: Record<string, OppState>;
  // internal — not displayed
  _week: string;
  _isDirty: boolean; // unsaved local changes
}

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  "Prod":                  { color: T.green,  bg: T.greenLight },
  "POC":                   { color: T.blue,   bg: T.blueLight },
  "Preprod":               { color: T.orange, bg: T.orangeLight },
  "On Hold - Future Date": { color: T.purple, bg: T.purpleLight },
  "On Hold - Migration":   { color: T.red,    bg: T.redLight },
};
const ENGAGEMENT_STYLE: Record<string, { color: string; bg: string }> = {
  "Active":   { color: T.green,  bg: T.greenLight },
  "Low":      { color: T.orange, bg: T.orangeLight },
  "At Risk":  { color: T.red,    bg: T.redLight },
  "Inactive": { color: T.gray,   bg: T.grayLight },
};
const AUTOOPT_STYLE: Record<string, { color: string; bg: string }> = {
  "Not Configured":         { color: T.gray,   bg: T.grayLight },
  "Enabled but Incomplete": { color: T.orange, bg: T.orangeLight },
  "In Progress":            { color: T.blue,   bg: T.blueLight },
  "Fully Operational":      { color: T.green,  bg: T.greenLight },
};
const STATUS_CHART_COLOR: Record<string, string> = {
  "Prod": T.green, "POC": T.blue, "Preprod": T.orange,
  "On Hold - Future Date": T.purple, "On Hold - Migration": T.red,
};
const ENGAGEMENT_CHART_COLOR: Record<string, string> = {
  "Active": T.green, "Low": T.orange, "At Risk": T.red, "Inactive": T.gray,
};
const AUTOOPT_CHART_COLOR: Record<string, string> = {
  "Not Configured": "#d0d0d0", "Enabled but Incomplete": T.orange,
  "In Progress": T.blue, "Fully Operational": T.green,
};

// ─── Data mapping from CustomerSnapshot ──────────────────────────────────────
type CustomFields = {
  statusOverride?: string;
  engagementOverride?: string;
  autoOptOverride?: string;
  migration?: string;
  migrationPath?: string;
  holdReason?: string;
  holdDate?: string;
  notes?: string;
  updatedAt?: string;
  enabledOpportunities?: Record<string, OppState | boolean>;
};

function parseCustomFields(raw: Record<string, unknown>): CustomFields {
  try {
    const cf = raw.customFields;
    if (!cf) return {};
    const parsed = typeof cf === "string" ? JSON.parse(cf) : cf;
    return (parsed as CustomFields) || {};
  } catch {
    return {};
  }
}

function mapStatus(raw: Record<string, unknown>, cf: CustomFields): CustomerStatus {
  if (cf.statusOverride && STATUS_OPTIONS.includes(cf.statusOverride as CustomerStatus)) {
    return cf.statusOverride as CustomerStatus;
  }
  const s = String(raw.status || "").toLowerCase().replace(/\s+/g, "-");
  if (s === "onboarding")     return "POC";
  if (s === "pre-production") return "Preprod";
  if (s === "on-hold")        return "On Hold - Future Date";
  if (s === "churned")        return "On Hold - Migration";
  return "Prod";
}

function mapEngagement(raw: Record<string, unknown>, cf: CustomFields): EngagementState {
  if (cf.engagementOverride && ENGAGEMENT_STATES.includes(cf.engagementOverride as EngagementState)) {
    return cf.engagementOverride as EngagementState;
  }
  const s = String(raw.status || "").toLowerCase().replace(/\s+/g, "-");
  if (s === "at-risk") return "At Risk";
  if (s === "churned") return "Inactive";
  const eng = String(raw.engagement || "").toLowerCase();
  if (eng === "high" || eng === "medium") return "Active";
  if (eng === "low") return "Low";
  return "Inactive";
}

function mapAutoOpt(raw: Record<string, unknown>, cf: CustomFields): AutoOptState {
  if (cf.autoOptOverride && AUTO_OPT_STATES.includes(cf.autoOptOverride as AutoOptState)) {
    return cf.autoOptOverride as AutoOptState;
  }
  const pressed = String(raw.autoOptimizeButtonPressed || "").toLowerCase();
  if (pressed === "yes" || pressed === "true") return "In Progress";
  return "Not Configured";
}

function parseOppMap(raw: Record<string, OppState | boolean> | undefined): Record<string, OppState> {
  if (!raw) return {};
  const out: Record<string, OppState> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === "boolean" ? { enabled: v, used: false } : v;
  }
  return out;
}

function snapshotToCustomer(raw: Record<string, unknown>): Customer {
  const cf = parseCustomFields(raw);
  return {
    id:         String(raw.companyName),
    name:       String(raw.companyName),
    status:     mapStatus(raw, cf),
    engagement: mapEngagement(raw, cf),
    autoOpt:    mapAutoOpt(raw, cf),
    migration:            cf.migration ?? String(raw.deploymentType || ""),
    migrationPath:        cf.migrationPath ?? "",
    holdReason:           cf.holdReason ?? "",
    holdDate:             cf.holdDate ?? "",
    notes:                cf.notes ?? String(raw.summary || ""),
    enabledOpportunities: parseOppMap(cf.enabledOpportunities),
    _week:                String(raw.week || ""),
    _isDirty:             false,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Pill({ label, styleMap }: { label: string; styleMap: Record<string, { color: string; bg: string }> }) {
  const s = styleMap[label] || { color: T.gray, bg: T.grayLight };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 500, background: s.bg, color: s.color, whiteSpace: "nowrap", fontFamily: "'Source Code Pro', monospace" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "14px 18px", flex: 1, minWidth: 105, borderLeft: `3px solid ${color}`, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: T.textTertiary, marginTop: 2, fontFamily: "'Source Code Pro', monospace" }}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "16px 18px", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", ...style }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: T.textSecondary, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.6px" }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 9px", borderRadius: 4, background: T.surface,
  border: `1px solid ${T.borderStrong}`, color: T.text,
  fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, outline: "none", boxSizing: "border-box",
};

function Sel({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
      {options.map(o => <option key={o} value={o}>{o || "— none —"}</option>)}
    </select>
  );
}

// ─── SVG Donut chart ──────────────────────────────────────────────────────────
function DonutChart({ data, colorMap, total }: { data: { name: string; value: number }[]; colorMap: Record<string, string>; total: number }) {
  const cx = 85, cy = 85, r = 63, ri = 42;
  const totalVal = data.reduce((s, d) => s + d.value, 0) || 1;
  let cumAngle = -90;
  const segments: React.ReactNode[] = [];

  data.forEach(d => {
    if (!d.value) return;
    const angle = (d.value / totalVal) * 360;
    const sweep = angle - (data.length > 1 ? 2 : 0);
    const s1 = cumAngle * Math.PI / 180;
    const e1 = (cumAngle + sweep) * Math.PI / 180;
    const x1 = cx + r * Math.cos(s1), y1 = cy + r * Math.sin(s1);
    const x2 = cx + r * Math.cos(e1), y2 = cy + r * Math.sin(e1);
    const ix1 = cx + ri * Math.cos(e1), iy1 = cy + ri * Math.sin(e1);
    const ix2 = cx + ri * Math.cos(s1), iy2 = cy + ri * Math.sin(s1);
    const lg = sweep > 180 ? 1 : 0;
    const color = colorMap[d.name] || T.gray;
    segments.push(
      <path key={d.name} d={`M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ri} ${ri} 0 ${lg} 0 ${ix2} ${iy2} Z`} fill={color} />
    );
    cumAngle += angle;
  });

  return (
    <div style={{ position: "relative", height: 170 }}>
      <svg width="100%" height="170" viewBox="0 0 170 170" style={{ overflow: "visible" }}>
        {segments.length
          ? segments
          : <circle cx="85" cy="85" r="63" fill="none" stroke={T.border} strokeWidth="21" />}
      </svg>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: T.text, lineHeight: 1 }}>{total}</div>
        <div style={{ fontSize: 10, color: T.textTertiary, marginTop: 2 }}>total</div>
      </div>
    </div>
  );
}

function ChartLegend({ data, colorMap }: { data: { name: string; value: number }[]; colorMap: Record<string, string> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
      {data.map(d => (
        <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: colorMap[d.name] || T.gray, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: T.textSecondary }}>{d.name}</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.text, fontFamily: "'Source Code Pro', monospace" }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Horizontal bar chart ─────────────────────────────────────────────────────
function HBarChart({ data, colorMap }: { data: { name: string; value: number }[]; colorMap: Record<string, string> }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {data.map(d => (
        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: T.textSecondary, width: 155, flexShrink: 0, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.name}>{d.name}</div>
          <div style={{ flex: 1, background: T.grayLight, borderRadius: 3, height: 18, overflow: "hidden" }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", background: colorMap[d.name] || T.gray, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, transition: "width 0.3s" }}>
              {d.value > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: "'Source Code Pro', monospace" }}>{d.value}</span>}
            </div>
          </div>
          {d.value === 0 && <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Source Code Pro', monospace", color: T.textSecondary }}>0</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Stacked bar chart ────────────────────────────────────────────────────────
function StackedBarChart({ customers }: { customers: Customer[] }) {
  const data = STATUS_OPTIONS.map(s => {
    const grp = customers.filter(c => c.status === s);
    const counts: Record<string, number> = {};
    ENGAGEMENT_STATES.forEach(e => { counts[e] = grp.filter(c => c.engagement === e).length; });
    return { name: s, total: grp.length, ...counts };
  });
  const maxTotal = Math.max(...data.map(d => d.total), 1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 160, paddingBottom: 24, overflowX: "auto", minWidth: 400 }}>
        {data.map(d => (
          <div key={d.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, height: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column-reverse", width: "100%", flex: 1, height: `${(d.total / maxTotal) * 100}%` }}>
              {ENGAGEMENT_STATES.map(e => {
                const v = (d as unknown as Record<string, number>)[e] ?? 0;
                return v > 0 ? (
                  <div key={e} style={{ width: "100%", height: `${(v / d.total) * 100}%`, background: ENGAGEMENT_CHART_COLOR[e], minHeight: 0 }} />
                ) : null;
              })}
            </div>
            <div style={{ fontSize: 10, color: T.textSecondary, marginTop: 5, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{d.name}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {ENGAGEMENT_STATES.map(e => (
          <div key={e} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: ENGAGEMENT_CHART_COLOR[e] }} />
            <span style={{ fontSize: 11, color: T.textSecondary }}>{e}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Opportunity adoption chart ───────────────────────────────────────────────
type OppAdoptionCategory = {
  name: string;
  items: { id: string; label: string; enabledCount: number; usedCount: number; total: number; enabledPct: number; usedPct: number }[];
};

function OppAdoptionChart({ categories }: { categories: OppAdoptionCategory[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
      {categories.map(cat => (
        <div key={cat.name}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.textTertiary, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10, borderBottom: `1px solid ${T.border}`, paddingBottom: 5 }}>{cat.name}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cat.items.map(item => (
              <div key={item.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }} title={item.label}>{item.label}</span>
                  <span style={{ fontSize: 10, color: T.textSecondary, fontFamily: "'Source Code Pro', monospace", flexShrink: 0 }}>{item.total} customers</span>
                </div>
                {/* Enabled bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: T.textTertiary, width: 44, flexShrink: 0, textAlign: "right" }}>Enabled</span>
                  <div style={{ flex: 1, height: 8, background: T.grayLight, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${item.enabledPct}%`, height: "100%", background: item.enabledPct >= 75 ? T.green : item.enabledPct >= 40 ? T.blue : item.enabledPct > 0 ? T.orange : "transparent", borderRadius: 99, transition: "width 0.4s" }} />
                  </div>
                  <span style={{ fontSize: 9, fontFamily: "'Source Code Pro', monospace", color: T.textSecondary, width: 32, flexShrink: 0 }}>{item.enabledCount}/{item.total}</span>
                </div>
                {/* Used bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 9, color: T.textTertiary, width: 44, flexShrink: 0, textAlign: "right" }}>Used</span>
                  <div style={{ flex: 1, height: 6, background: T.grayLight, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${item.usedPct}%`, height: "100%", background: item.usedCount > 0 ? T.green : "transparent", borderRadius: 99, transition: "width 0.4s" }} />
                  </div>
                  <span style={{ fontSize: 9, fontFamily: "'Source Code Pro', monospace", color: T.textSecondary, width: 32, flexShrink: 0 }}>{item.usedCount}/{item.total}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Callout ──────────────────────────────────────────────────────────────────
function Callout({ num, text, bg, color }: { num: number | string; text: string; bg: string; color: string }) {
  return (
    <div style={{ marginTop: 10, padding: "8px 12px", background: bg, borderRadius: 4, display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{num}</div>
      <div style={{ fontSize: 11, color: T.textSecondary }}>{text}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const BLANK_NEW: Omit<Customer, "id"> = { name: "", status: "Prod", engagement: "Active", autoOpt: "Not Configured", migration: "", migrationPath: "", holdReason: "", holdDate: "", notes: "", enabledOpportunities: {}, _week: "", _isDirty: true };
const FILTERS = ["All", "Active", "On Hold", "Prod", "POC", "Preprod", "On Hold - Future Date", "On Hold - Migration"];

export default function CustomerStatusDashboard() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<Customer | null>(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [showAdd, setShowAdd]     = useState(false);
  const [tab, setTab]             = useState<"Overview" | "Table">("Overview");
  const [newC, setNewC]           = useState({ ...BLANK_NEW });
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});

  // Fetch + deduplicate customer snapshots
  useEffect(() => {
    fetch("/api/customers")
      .then(r => r.json())
      .then(res => {
        if (res.error) throw new Error(res.error);
        const byCompany: Record<string, Record<string, unknown>> = {};
        for (const c of (res.data as Record<string, unknown>[]) || []) {
          if (c.hidden) continue;
          const name = String(c.companyName);
          if (!byCompany[name] || String(c.week) > String(byCompany[name].week || "")) {
            byCompany[name] = c;
          }
        }
        setCustomers(Object.values(byCompany).map(snapshotToCustomer));
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const filtered = useMemo(() => filterStatus === "All" ? customers
    : customers.filter(c =>
        filterStatus === "Active"  ? ["Prod", "POC", "Preprod"].includes(c.status)
        : filterStatus === "On Hold" ? c.status.startsWith("On Hold")
        : c.status === filterStatus), [customers, filterStatus]);

  const moving   = useMemo(() => customers.filter(c => ["Prod", "POC", "Preprod"].includes(c.status)), [customers]);
  const onHold   = useMemo(() => customers.filter(c => c.status.startsWith("On Hold")), [customers]);
  const fullyOpt = useMemo(() => customers.filter(c => c.autoOpt === "Fully Operational"), [customers]);
  const atRisk   = useMemo(() => customers.filter(c => c.engagement === "At Risk" || c.engagement === "Inactive"), [customers]);

  const statusData    = useMemo(() => STATUS_OPTIONS.map(s => ({ name: s, value: customers.filter(c => c.status === s).length })).filter(d => d.value > 0), [customers]);
  const engagementData = useMemo(() => ENGAGEMENT_STATES.map(s => ({ name: s, value: customers.filter(c => c.engagement === s).length })).filter(d => d.value > 0), [customers]);
  const autoOptData   = useMemo(() => AUTO_OPT_STATES.map(s => ({ name: s, value: customers.filter(c => c.autoOpt === s).length })), [customers]);
  const migrationData = useMemo(() => {
    const reasons: Record<string, number> = {};
    onHold.forEach(c => { const k = c.holdReason || c.migration || "Unspecified"; reasons[k] = (reasons[k] || 0) + 1; });
    return Object.entries(reasons).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [onHold]);

  const autoOptPct = customers.length ? Math.round((fullyOpt.length / customers.length) * 100) : 0;

  const oppAdoptionData = useMemo<OppAdoptionCategory[]>(() =>
    AUTO_OPT_OPPORTUNITIES.map(cat => ({
      name: cat.name,
      items: cat.opportunities.map(opp => {
        const enabledCount = customers.filter(c => c.enabledOpportunities[opp.id]?.enabled).length;
        const usedCount    = customers.filter(c => c.enabledOpportunities[opp.id]?.used).length;
        const total = customers.length;
        return {
          id: opp.id, label: opp.label, total,
          enabledCount, usedCount,
          enabledPct: total ? Math.round(enabledCount / total * 100) : 0,
          usedPct:    total ? Math.round(usedCount    / total * 100) : 0,
        };
      }),
    })),
  [customers]);

  const update = (id: string, field: keyof Customer, val: string) => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, [field]: val, _isDirty: true } : c));
    setSelected(prev => prev?.id === id ? { ...prev, [field]: val, _isDirty: true } as Customer : prev);
    // Clear any prior save feedback when user edits again
    setSaveState(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const updateOpportunity = (id: string, oppId: string, field: keyof OppState, value: boolean) => {
    const patch = (map: Record<string, OppState>) => ({
      ...map,
      [oppId]: { ...(map[oppId] ?? { enabled: false, used: false }), [field]: value },
    });
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, enabledOpportunities: patch(c.enabledOpportunities), _isDirty: true } : c));
    setSelected(prev => prev?.id === id ? { ...prev, enabledOpportunities: patch(prev.enabledOpportunities), _isDirty: true } as Customer : prev);
    setSaveState(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const saveCustomer = async (c: Customer) => {
    setSaveState(prev => ({ ...prev, [c.id]: "saving" }));
    try {
      const customFields: CustomFields = {
        statusOverride:       c.status,
        engagementOverride:   c.engagement,
        autoOptOverride:      c.autoOpt,
        migration:            c.migration,
        migrationPath:        c.migrationPath,
        holdReason:           c.holdReason,
        holdDate:             c.holdDate,
        notes:                c.notes,
        enabledOpportunities: c.enabledOpportunities,
        updatedAt:            new Date().toISOString(),
      };
      const res = await fetch("/api/customers/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omit week — server defaults to current Monday so customFields always
        // land on the latest snapshot (the one the dashboard will display after refresh).
        body: JSON.stringify({ companyName: c.name, customFields }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Save failed");
      setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, _isDirty: false } : x));
      setSelected(prev => prev?.id === c.id ? { ...prev, _isDirty: false } as Customer : prev);
      setSaveState(prev => ({ ...prev, [c.id]: "saved" }));
    } catch (err) {
      setSaveState(prev => ({ ...prev, [c.id]: "error" }));
      console.error("[saveCustomer]", err);
    }
  };

  const addCustomer = () => {
    if (!newC.name.trim()) return;
    setCustomers(prev => [...prev, { ...newC, id: `new-${Date.now()}` }]);
    setNewC({ ...BLANK_NEW });
    setShowAdd(false);
  };

  const sel = selected ? customers.find(c => c.id === selected.id) ?? null : null;

  // ─── Loading / error ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, gap: 12, color: T.textSecondary, fontFamily: "'Source Sans 3', sans-serif" }}>
        <div style={{ width: 20, height: 20, border: `2px solid ${T.border}`, borderTopColor: T.blue, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        Loading customer data…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (error) {
    return <div style={{ margin: "24px 28px", background: T.redLight, border: `1px solid #f9d0ce`, borderRadius: 6, padding: "16px 18px", color: T.red, fontFamily: "'Source Sans 3', sans-serif" }}><strong>Failed to load data:</strong> {error}</div>;
  }

  return (
    <div style={{ background: T.bg, minHeight: "100%", fontFamily: "'Source Sans 3', system-ui, sans-serif", color: T.text, fontSize: 14 }}>
      <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&family=Source+Code+Pro:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 1, height: 22, background: T.border }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>ASO Customer Status</div>
            <div style={{ fontSize: 11, color: T.textSecondary }}>AEM Sites Optimizer · Single Source of Truth</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", background: T.surfaceSecondary, border: `1px solid ${T.border}`, borderRadius: 4, overflow: "hidden" }}>
            {(["Overview", "Table"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: tab === t ? T.surface : "transparent", color: tab === t ? T.blue : T.textSecondary, borderRight: t !== "Table" ? `1px solid ${T.border}` : "none", fontFamily: "inherit" }}>{t}</button>
            ))}
          </div>
          <button onClick={() => setShowAdd(true)} style={{ background: T.blue, border: "none", borderRadius: 4, padding: "7px 15px", color: "#fff", fontFamily: "inherit", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>+ Add Customer</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "18px 28px", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard label="Total Customers" value={customers.length} color={T.text} />
        <StatCard label="Active" value={moving.length} sub="Prod · POC · Preprod" color={T.green} />
        <StatCard label="On Hold" value={onHold.length} sub="Migration · Future Date" color={T.red} />
        <StatCard label="Auto-Optimize ✓" value={fullyOpt.length} sub="Fully Operational" color={T.blue} />
        <StatCard label="At Risk / Inactive" value={atRisk.length} sub="Needs attention" color={T.orange} />
      </div>

      {/* ── OVERVIEW TAB ──────────────────────────────────────────────────── */}
      {tab === "Overview" && (
        <div style={{ padding: "0 28px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <ChartCard title="Customer Status">
              <DonutChart data={statusData} colorMap={STATUS_CHART_COLOR} total={customers.length} />
              <ChartLegend data={statusData} colorMap={STATUS_CHART_COLOR} />
            </ChartCard>
            <ChartCard title="Engagement Health">
              <DonutChart data={engagementData} colorMap={ENGAGEMENT_CHART_COLOR} total={customers.length} />
              <ChartLegend data={engagementData} colorMap={ENGAGEMENT_CHART_COLOR} />
            </ChartCard>
            <ChartCard title="Auto-Optimize State">
              <DonutChart data={autoOptData.filter(d => d.value > 0)} colorMap={AUTOOPT_CHART_COLOR} total={customers.length} />
              <ChartLegend data={autoOptData.filter(d => d.value > 0)} colorMap={AUTOOPT_CHART_COLOR} />
            </ChartCard>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <ChartCard title="Auto-Optimize Journey — All Customers">
              <HBarChart data={autoOptData} colorMap={AUTOOPT_CHART_COLOR} />
              <Callout num={`${autoOptPct}%`} text="of customers fully Auto-Optimized" bg={T.blueLight} color={T.blue} />
            </ChartCard>
            <ChartCard title="On Hold — Reasons Breakdown">
              {onHold.length === 0
                ? <div style={{ padding: "40px 0", textAlign: "center", color: T.textTertiary, fontSize: 13 }}>No customers on hold</div>
                : <>
                    <HBarChart data={migrationData} colorMap={{ "AMS Migration": T.red, "On Prem - AEM Migration": T.red, "On Prem - Non-AEM Migration": T.red, "Compliance": T.purple, "Future Date": T.purple, "Org Readiness": T.orange, "Other": T.gray, "Unspecified": T.textTertiary }} />
                    <Callout num={onHold.length} text={`customers on hold · ${Math.round(onHold.length / customers.length * 100)}% of portfolio`} bg={T.redLight} color={T.red} />
                  </>
              }
            </ChartCard>
          </div>

          <div style={{ marginTop: 12 }}>
            <ChartCard title="Engagement by Customer Status">
              <StackedBarChart customers={customers} />
            </ChartCard>
          </div>

          <div style={{ marginTop: 12 }}>
            <ChartCard title="Auto-Optimize Opportunity Adoption — % of Customers with Each Opportunity Enabled">
              {customers.length === 0
                ? <div style={{ padding: "32px 0", textAlign: "center", color: T.textTertiary, fontSize: 13 }}>No customer data</div>
                : <>
                    <OppAdoptionChart categories={oppAdoptionData} />
                    <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 10, height: 8, borderRadius: 99, background: T.green }} /><span style={{ fontSize: 11, color: T.textSecondary }}>Enabled ≥75%</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 10, height: 8, borderRadius: 99, background: T.blue }} /><span style={{ fontSize: 11, color: T.textSecondary }}>Enabled 40–74%</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 10, height: 8, borderRadius: 99, background: T.orange }} /><span style={{ fontSize: 11, color: T.textSecondary }}>Enabled &lt;40%</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 10, height: 6, borderRadius: 99, background: T.green }} /><span style={{ fontSize: 11, color: T.textSecondary }}>Used by customer</span></div>
                    </div>
                  </>
              }
            </ChartCard>
          </div>
        </div>
      )}

      {/* ── TABLE TAB ─────────────────────────────────────────────────────── */}
      {tab === "Table" && (
        <>
          <div style={{ padding: "10px 28px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilterStatus(f)} style={{ padding: "4px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: "pointer", border: filterStatus === f ? `1px solid ${T.blue}` : `1px solid ${T.border}`, background: filterStatus === f ? T.blueLight : T.surface, color: filterStatus === f ? T.blue : T.textSecondary, fontFamily: "inherit" }}>{f}</button>
            ))}
          </div>

          <div style={{ display: "flex" }}>
            <div style={{ flex: 1, padding: "0 28px 32px", overflowX: "auto" }}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: T.surfaceSecondary, borderBottom: `1px solid ${T.border}` }}>
                      {["Customer", "Status", "Auto-Optimize", "Migration / Hold", "Notes"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 11, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: T.textTertiary, fontSize: 13 }}>No customers match this filter</td></tr>
                    ) : filtered.map((c, idx) => (
                      <tr key={c.id}
                        onClick={() => setSelected(c)}
                        style={{ borderBottom: idx < filtered.length - 1 ? `1px solid ${T.border}` : "none", cursor: "pointer", background: sel?.id === c.id ? "#eaf3fe" : "transparent" }}
                        onMouseEnter={e => { if (sel?.id !== c.id) (e.currentTarget as HTMLElement).style.background = T.surfaceSecondary; }}
                        onMouseLeave={e => { if (sel?.id !== c.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{c.name}</td>
                        <td style={{ padding: "10px 14px" }}><Pill label={c.status} styleMap={STATUS_STYLE} /></td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Pill label={c.autoOpt} styleMap={AUTOOPT_STYLE} />
                            {(() => {
                              const vals = Object.values(c.enabledOpportunities);
                              const en = vals.filter(v => v.enabled).length;
                              const us = vals.filter(v => v.used).length;
                              if (en === 0 && us === 0) return null;
                              return <span style={{ fontSize: 10, color: T.blue, fontFamily: "'Source Code Pro', monospace", whiteSpace: "nowrap" }}>{en} enabled{us > 0 ? ` · ${us} used` : ""}</span>;
                            })()}
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "'Source Code Pro', monospace", fontSize: 11, color: T.textSecondary }}>
                          {c.migration || c.holdReason || <span style={{ color: T.textTertiary }}>—</span>}
                          {c.holdDate && <span style={{ color: T.textTertiary }}> · {c.holdDate}</span>}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: T.textSecondary, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.notes || <span style={{ color: T.textTertiary }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detail Panel */}
            {sel && (
              <div style={{ width: 500, minWidth: 500, borderLeft: `1px solid ${T.border}`, padding: "18px 16px", background: T.surface, display: "flex", flexDirection: "column", gap: 13, overflowY: "auto", maxHeight: "calc(100vh - 200px)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{sel.name}</div>
                    <div style={{ fontSize: 10, color: T.textTertiary, fontFamily: "'Source Code Pro', monospace", marginTop: 1 }}>{sel.status}</div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: `1px solid ${T.border}`, color: T.textSecondary, cursor: "pointer", borderRadius: 4, width: 24, height: 24, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                </div>
                <div style={{ height: 1, background: T.border }} />
                <Field label="Status"><Sel value={sel.status} options={STATUS_OPTIONS} onChange={v => update(sel.id, "status", v)} /></Field>
                <Field label="Engagement"><Sel value={sel.engagement} options={ENGAGEMENT_STATES} onChange={v => update(sel.id, "engagement", v)} /></Field>
                <Field label="Auto-Optimize State"><Sel value={sel.autoOpt} options={AUTO_OPT_STATES} onChange={v => update(sel.id, "autoOpt", v)} /></Field>
                {sel.status.startsWith("On Hold") && <>
                  <Field label="Hold Reason"><Sel value={sel.holdReason} options={["", ...HOLD_REASONS]} onChange={v => update(sel.id, "holdReason", v)} /></Field>
                  <Field label="Expected Re-engagement"><input type="date" value={sel.holdDate} onChange={e => update(sel.id, "holdDate", e.target.value)} style={inputStyle} /></Field>
                </>}
                {sel.status === "On Hold - Migration" && (
                  <Field label="Migration Path"><Sel value={sel.migrationPath} options={MIGRATION_PATHS} onChange={v => update(sel.id, "migrationPath", v)} /></Field>
                )}
                <Field label="Implementation"><Sel value={sel.migration} options={MIGRATION_TYPES} onChange={v => update(sel.id, "migration", v)} /></Field>
                <Field label="Notes"><textarea value={sel.notes} onChange={e => update(sel.id, "notes", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></Field>
                <div style={{ height: 1, background: T.border }} />

                {/* Save button */}
                {(() => {
                  const st = saveState[sel.id];
                  const isDirty = sel._isDirty;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        onClick={() => saveCustomer(sel)}
                        disabled={st === "saving" || (!isDirty && st !== "error")}
                        style={{
                          width: "100%", padding: "8px", borderRadius: 4, fontFamily: "inherit",
                          fontWeight: 600, fontSize: 13, cursor: isDirty || st === "error" ? "pointer" : "default",
                          border: "none",
                          background: st === "saving" ? T.borderStrong
                            : st === "error" ? T.red
                            : isDirty ? T.blue
                            : T.grayLight,
                          color: st === "saving" || st === "error" || isDirty ? "#fff" : T.textTertiary,
                          transition: "background 0.15s",
                        }}
                      >
                        {st === "saving" ? "Saving…" : st === "error" ? "Retry Save" : "Save Changes"}
                      </button>
                      {st === "saved" && !isDirty && (
                        <div style={{ fontSize: 11, color: T.green, textAlign: "center" }}>✓ Saved — changes are protected from sync overwrites</div>
                      )}
                      {st === "error" && (
                        <div style={{ fontSize: 11, color: T.red, textAlign: "center" }}>Save failed — check your connection and retry</div>
                      )}
                      {isDirty && !st && (
                        <div style={{ fontSize: 11, color: T.textTertiary, textAlign: "center" }}>Unsaved changes</div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ height: 1, background: T.border }} />
                <div>
                  <div style={{ fontSize: 10, color: T.textSecondary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10 }}>Auto-Optimize Journey</div>
                  {AUTO_OPT_STATES.map((s, i) => {
                    const curr = AUTO_OPT_STATES.indexOf(sel.autoOpt as typeof AUTO_OPT_STATES[number]);
                    const done = i <= curr, active = i === curr;
                    const ss = AUTOOPT_STYLE[sel.autoOpt];
                    return (
                      <div key={s} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
                        <div style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, background: done ? ss.bg : T.surfaceSecondary, border: `2px solid ${done ? ss.color : T.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: done ? ss.color : T.textTertiary, fontWeight: 700 }}>{done ? "✓" : ""}</div>
                        <span style={{ fontSize: 12, color: active ? ss.color : done ? T.text : T.textTertiary, fontWeight: active ? 600 : 400 }}>{s}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ height: 1, background: T.border }} />

                {/* Opportunity enablement checklist */}
                <div>
                  {/* Column headers */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: T.textSecondary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px" }}>Auto-Optimize Opportunities</div>
                    {(() => {
                      const vals = Object.values(sel.enabledOpportunities);
                      const en = vals.filter(v => v.enabled).length;
                      const us = vals.filter(v => v.used).length;
                      return (
                        <span style={{ fontSize: 10, fontFamily: "'Source Code Pro', monospace", color: en > 0 ? T.blue : T.textTertiary, fontWeight: 600 }}>
                          {en}/{ALL_OPP_COUNT}{us > 0 ? ` · ${us} used` : ""}
                        </span>
                      );
                    })()}
                  </div>
                  {/* Per-category blocks */}
                  {AUTO_OPT_OPPORTUNITIES.map(cat => {
                    const catEnabled = cat.opportunities.filter(o => sel.enabledOpportunities[o.id]?.enabled).length;
                    const allOn = catEnabled === cat.opportunities.length;
                    return (
                      <div key={cat.name} style={{ marginBottom: 10, background: T.surfaceSecondary, borderRadius: 5, padding: "8px 10px" }}>
                        {/* Category header row */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.5px" }}>{cat.name}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 10, color: catEnabled > 0 ? T.blue : T.textTertiary, fontFamily: "'Source Code Pro', monospace" }}>{catEnabled}/{cat.opportunities.length}</span>
                            <button
                              onClick={() => cat.opportunities.forEach(o => updateOpportunity(sel.id, o.id, "enabled", !allOn))}
                              style={{ fontSize: 10, color: T.blue, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textDecoration: "underline" }}
                            >{allOn ? "none" : "all"}</button>
                          </div>
                        </div>
                        {/* Column labels */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", gap: 4, marginBottom: 3, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>
                          <span style={{ fontSize: 9, color: T.textTertiary, textTransform: "uppercase", letterSpacing: "0.4px" }}> </span>
                          <span style={{ fontSize: 9, color: T.textTertiary, textTransform: "uppercase", letterSpacing: "0.4px", textAlign: "center" }}>Enabled</span>
                          <span style={{ fontSize: 9, color: T.textTertiary, textTransform: "uppercase", letterSpacing: "0.4px", textAlign: "center" }}>Used by customer</span>
                        </div>
                        {/* Opportunity rows */}
                        {cat.opportunities.map(opp => {
                          const state = sel.enabledOpportunities[opp.id] ?? { enabled: false, used: false };
                          return (
                            <div key={opp.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", gap: 4, alignItems: "center", padding: "3px 0" }}>
                              <span style={{ fontSize: 12, color: state.enabled ? T.text : T.textSecondary, fontWeight: state.enabled ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={opp.label}>{opp.label}</span>
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                <input type="checkbox" checked={state.enabled} onChange={e => updateOpportunity(sel.id, opp.id, "enabled", e.target.checked)} style={{ cursor: "pointer", width: 14, height: 14, accentColor: T.blue }} />
                              </div>
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                <input type="checkbox" checked={state.used} onChange={e => updateOpportunity(sel.id, opp.id, "used", e.target.checked)} style={{ cursor: "pointer", width: 14, height: 14, accentColor: T.green }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── ADD CUSTOMER MODAL ────────────────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 22, width: 370, display: "flex", flexDirection: "column", gap: 13, boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Add Customer</div>
            <div style={{ height: 1, background: T.border }} />
            <Field label="Name"><input value={newC.name} onChange={e => setNewC(p => ({ ...p, name: e.target.value }))} placeholder="Customer name" style={inputStyle} /></Field>
            <Field label="Status"><Sel value={newC.status} options={STATUS_OPTIONS} onChange={v => setNewC(p => ({ ...p, status: v as CustomerStatus }))} /></Field>
            <Field label="Engagement"><Sel value={newC.engagement} options={ENGAGEMENT_STATES} onChange={v => setNewC(p => ({ ...p, engagement: v as EngagementState }))} /></Field>
            <Field label="Auto-Optimize"><Sel value={newC.autoOpt} options={AUTO_OPT_STATES} onChange={v => setNewC(p => ({ ...p, autoOpt: v as AutoOptState }))} /></Field>
            <Field label="Notes"><input value={newC.notes} onChange={e => setNewC(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" style={inputStyle} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addCustomer} style={{ flex: 1, padding: 8, borderRadius: 4, background: T.blue, border: "none", color: "#fff", fontFamily: "inherit", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Add Customer</button>
              <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: 8, borderRadius: 4, background: T.surface, border: `1px solid ${T.borderStrong}`, color: T.textSecondary, fontFamily: "inherit", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
