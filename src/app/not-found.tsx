import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <div className={styles.page}>
      <svg viewBox="1 0 38 18" className={styles.number} aria-hidden="true">
        <text x="0" y="17" fontFamily="monospace">
          404
        </text>
      </svg>
      <h2 className={styles.message}>Page Not Found</h2>
      <div className={styles.actions}>
        <Link href="/" className={styles.btn}>
          Go home
        </Link>
      </div>
    </div>
  );
}
