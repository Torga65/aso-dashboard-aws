import type { EngagementLevel } from "@/lib/types";

interface Props {
  level: EngagementLevel;
}

const STYLE_MAP: Record<string, React.CSSProperties> = {
  high: { background: "#d1fae5", color: "#065f46" },
  medium: { background: "#fed7aa", color: "#92400e" },
  low: { background: "#fecaca", color: "#991b1b" },
  none: { background: "#f3f4f6", color: "#6b7280" },
  unknown: { background: "#f3f4f6", color: "#6b7280" },
};

const BASE: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: "12px",
  fontSize: "12px",
  fontWeight: 600,
};

export function EngagementBadge({ level }: Props) {
  const key = level.toLowerCase();
  const style = { ...BASE, ...(STYLE_MAP[key] ?? STYLE_MAP.unknown) };
  return <span style={style}>{level}</span>;
}
