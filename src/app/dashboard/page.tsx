import type { Metadata } from "next";
import { AISummary } from "@/components/ui/AISummary";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { HealthBar } from "@/components/ui/HealthBar";
import type { AISummarySection } from "@/lib/types";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Static sample data to demonstrate the layout.
// TODO: Replace with a real DynamoDB fetch.
const SAMPLE_AI_SECTIONS: AISummarySection[] = [
  {
    title: "Key Insights",
    content:
      "User engagement has increased 15% month-over-month\n• Session duration is up significantly\n• Feature adoption rate for new releases is exceeding projections\n• Support ticket volume has decreased by 20%",
  },
  {
    title: "Recommendations",
    content:
      "Expand onboarding program to additional departments\n• Consider early access program for power users\n• Schedule quarterly business review to align on strategic goals",
  },
  {
    title: "Risk Factors",
    content:
      "Upcoming contract renewal in Q4 2024\n• Potential budget constraints mentioned in last QBR\n• Competitive pressure from emerging solutions",
  },
];

export default function DashboardPage() {
  return (
    <div className="container" style={{ paddingTop: "24px", paddingBottom: "60px" }}>
      <h1>Unified Dashboard</h1>
      <p className={styles.intro}>
        Welcome to the unified client engagement dashboard. This page demonstrates
        the key components for tracking client metrics and insights.
      </p>

      {/* Client detail */}
      <section className={styles.section}>
        <h2>Client Information</h2>
        <div className={styles.clientHeader}>
          <div className={styles.clientInfo}>
            <h3 className={styles.clientName}>Acme Corporation</h3>
            <StatusBadge status="Active" />
          </div>
        </div>

        <div className={styles.detailGrid}>
          {[
            ["Industry", "Technology"],
            ["Account Manager", "Jane Smith"],
            ["Region", "North America"],
            ["Contract Value", "$250,000"],
            ["Start Date", "January 15, 2024"],
            ["Deployment", "Cloud Service"],
          ].map(([label, value]) => (
            <div key={label} className={styles.detailCard}>
              <p className={styles.detailLabel}>{label}</p>
              <p className={styles.detailValue}>{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Engagement metrics */}
      <section className={styles.section}>
        <h2>Health Overview</h2>
        <div className={styles.metricsGrid}>
          {[
            { label: "Active Users", score: 85 },
            { label: "Session Duration", score: 72 },
            { label: "Feature Adoption", score: 91 },
            { label: "Support Load", score: 55 },
          ].map(({ label, score }) => (
            <div key={label} className={styles.metricCard}>
              <p className={styles.metricLabel}>{label}</p>
              <HealthBar score={score} />
            </div>
          ))}
        </div>
      </section>

      {/* AI Insights */}
      <section className={styles.section}>
        <h2>AI-Generated Insights</h2>
        <AISummary
          sections={SAMPLE_AI_SECTIONS}
          generatedAt={new Date().toLocaleDateString()}
        />
      </section>
    </div>
  );
}
