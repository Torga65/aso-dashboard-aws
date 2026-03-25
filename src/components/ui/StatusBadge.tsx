import type { CustomerStatus } from "@/lib/types";

interface Props {
  status: CustomerStatus;
  className?: string;
}

const STYLE_MAP: Record<string, React.CSSProperties> = {
  active: { background: "#dcfce7", color: "#166534" },
  production: { background: "#dcfce7", color: "#166534" },
  "at-risk": { background: "#fef3c7", color: "#92400e" },
  "on-hold": { background: "#fef3c7", color: "#92400e" },
  onboarding: { background: "#dbeafe", color: "#1e40af" },
  "pre-production": { background: "#dbeafe", color: "#1e40af" },
  churned: { background: "#fee2e2", color: "#991b1b" },
};

const BASE: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: "12px",
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  whiteSpace: "nowrap",
};

export function StatusBadge({ status, className }: Props) {
  const key = status.toLowerCase().replace(/\s+/g, "-");
  const style = { ...BASE, ...(STYLE_MAP[key] ?? { background: "#f3f4f6", color: "#6b7280" }) };
  return (
    <span style={style} className={className}>
      {status}
    </span>
  );
}
