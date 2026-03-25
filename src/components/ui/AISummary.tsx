import type { AISummarySection } from "@/lib/types";
import styles from "./AISummary.module.css";

interface Props {
  sections: AISummarySection[];
  generatedAt?: string;
  light?: boolean;
}

export function AISummary({ sections, generatedAt, light = false }: Props) {
  if (sections.length === 0) {
    return (
      <div className={`${styles.container} ${light ? styles.light : ""}`}>
        <p className={styles.empty}>No AI summary available.</p>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${light ? styles.light : ""}`}>
      <div className={styles.header}>
        <span className={styles.badge}>AI</span>
        <span className={styles.title}>Generated Insights</span>
      </div>

      <div className={styles.contentWrapper}>
        {sections.map((section) => (
          <div key={section.title} className={styles.section}>
            <h4 className={styles.sectionTitle}>{section.title}</h4>
            <div className={styles.sectionContent}>
              {parseSectionContent(section.content)}
            </div>
          </div>
        ))}
      </div>

      {generatedAt && (
        <div className={styles.footer}>Generated on {generatedAt}</div>
      )}
    </div>
  );
}

function parseSectionContent(content: string) {
  const lines = content
    .split(/\n|•/)
    .map((s) => s.replace(/^-\s*/, "").trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return <p style={{ margin: 0 }}>{content}</p>;
  }

  return (
    <ul>
      {lines.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
