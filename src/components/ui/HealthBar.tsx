interface Props {
  score: number; // 0–100
  showValue?: boolean;
}

function getColor(score: number) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

function getTextColor(score: number) {
  if (score >= 70) return "#16a34a";
  if (score >= 40) return "#ea580c";
  return "#dc2626";
}

export function HealthBar({ score, showValue = true }: Props) {
  const color = getColor(score);
  const textColor = getTextColor(score);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      {showValue && (
        <strong style={{ fontSize: "14px", fontWeight: 600, color: textColor, minWidth: "30px" }}>
          {score}
        </strong>
      )}
      <div
        style={{
          flex: 1,
          height: "8px",
          background: "#e5e7eb",
          borderRadius: "4px",
          overflow: "hidden",
          minWidth: "60px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, score))}%`,
            background: color,
            borderRadius: "4px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
