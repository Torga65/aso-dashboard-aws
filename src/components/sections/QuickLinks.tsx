import Link from "next/link";
import styles from "./QuickLinks.module.css";

export interface QuickLink {
  title: string;
  description: string;
  href: string;
  cta?: string;
}

interface Props {
  links: QuickLink[];
}

export function QuickLinks({ links }: Props) {
  return (
    <section className={styles.section}>
      <div className="container">
        <h2>Quick Links</h2>
        <ul className={styles.grid}>
          {links.map(({ title, description, href, cta = "View →" }) => (
            <li key={href} className={styles.card}>
              <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>{title}</h3>
                <p className={styles.cardDesc}>{description}</p>
                <p className={styles.cardCta}>
                  <Link href={href}>{cta}</Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
