import styles from "./LoadingSpinner.module.css";

interface LoadingSpinnerProps {
  /** Accessible label for screen readers. Defaults to "Loading…" */
  label?: string;
  /** Size variant. Defaults to "md". */
  size?: "sm" | "md" | "lg";
}

export function LoadingSpinner({ label = "Loading…", size = "md" }: LoadingSpinnerProps) {
  return (
    <div className={`${styles.wrapper} ${styles[size]}`} role="status" aria-label={label}>
      <div className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
