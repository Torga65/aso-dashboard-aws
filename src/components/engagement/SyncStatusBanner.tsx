import type { SyncJobRecord } from "@/lib/types";
import styles from "./SyncStatusBanner.module.css";

interface SyncStatusBannerProps {
  job: SyncJobRecord | null;
}

/**
 * Server Component — renders a one-line banner summarising the latest sync job.
 * Pass null to hide the banner (no jobs have run yet).
 */
export function SyncStatusBanner({ job }: SyncStatusBannerProps) {
  if (!job) return null;

  const isRunning   = job.status === "RUNNING";
  const isCompleted = job.status === "COMPLETED";
  const isFailed    = job.status === "FAILED";

  const bannerClass = `${styles.banner} ${
    isRunning   ? styles.running   :
    isCompleted ? styles.completed :
    isFailed    ? styles.failed    :
    ""
  }`;

  const icon = isRunning ? "⏳" : isCompleted ? "✅" : "❌";

  const startedAt = job.startedAt
    ? new Date(job.startedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  const duration =
    job.startedAt && job.completedAt
      ? formatDuration(
          new Date(job.completedAt).getTime() -
          new Date(job.startedAt).getTime()
        )
      : null;

  return (
    <div className={bannerClass} role="status" aria-live="polite">
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      <span className={styles.text}>
        <strong>Sync {job.status.toLowerCase()}</strong>
        {" — "}
        Started {startedAt}
        {duration && ` · ${duration}`}
        {isCompleted && job.recordsProcessed != null && (
          <> · {job.recordsProcessed.toLocaleString()} records</>
        )}
        {isFailed && job.errorMessage && (
          <> · {job.errorMessage}</>
        )}
      </span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
