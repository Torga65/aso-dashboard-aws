import styles from "./Hero.module.css";

interface Props {
  title: string;
  subtitle?: string;
}

export function Hero({ title, subtitle }: Props) {
  return (
    <section className={styles.hero}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
    </section>
  );
}
