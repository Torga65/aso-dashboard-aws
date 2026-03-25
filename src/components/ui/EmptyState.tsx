import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  title?: string;
  message?: string;
  /** Optional action button. */
  action?: React.ReactNode;
  /** Icon / illustration area. Pass an emoji or SVG element. */
  icon?: React.ReactNode;
}

export function EmptyState({
  title = "No data available",
  message,
  action,
  icon = "📭",
}: EmptyStateProps) {
  return (
    <div className={styles.wrapper} role="status">
      <div className={styles.icon} aria-hidden="true">{icon}</div>
      <h3 className={styles.title}>{title}</h3>
      {message && <p className={styles.message}>{message}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
