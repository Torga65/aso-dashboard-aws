import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p>
          &copy; {new Date().getFullYear()} Adobe. All rights reserved. &mdash;{" "}
          AEM Sites Optimizer Customer Engagement Dashboard
        </p>
      </div>
    </footer>
  );
}
