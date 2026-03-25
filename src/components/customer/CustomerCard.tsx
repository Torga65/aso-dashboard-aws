"use client";

import { useState } from "react";
import type { Customer } from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { HealthBar } from "@/components/ui/HealthBar";
import { EngagementBadge } from "@/components/ui/EngagementBadge";
import styles from "./CustomerCard.module.css";

interface Props {
  customer: Customer;
}

export function CustomerCard({ customer }: Props) {
  const [expanded, setExpanded] = useState(false);

  const hasBlockers =
    customer.blockers &&
    customer.blockers !== "None" &&
    customer.blockers !== "";

  return (
    <article className={`${styles.card} ${expanded ? styles.expanded : ""}`}>
      {/* Header */}
      <div className={styles.cardHeader}>
        <h3 className={styles.customerName}>{customer.companyName}</h3>
        <div className={styles.badges}>
          <StatusBadge status={customer.status} />
        </div>
      </div>

      {/* Metrics */}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Health</span>
          <HealthBar score={customer.healthScore} />
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Engagement</span>
          <EngagementBadge level={customer.engagement} />
        </div>
      </div>

      {/* Summary */}
      {customer.summary && (
        <div className={styles.summary}>
          <p className={`${styles.summaryText} ${expanded ? styles.summaryExpanded : ""}`}>
            {customer.summary}
          </p>
        </div>
      )}

      {/* Blockers alert */}
      {hasBlockers && (
        <div className={styles.alert}>
          <span className={styles.alertIcon}>⚠️</span>
          <span>{customer.blockers}</span>
        </div>
      )}

      {/* AI Insights (visible when expanded) */}
      {expanded && (
        <div className={styles.aiInsights}>
          <div className={styles.aiInsightsHeader}>
            <span className={styles.aiIcon}>🤖</span>
            <h4>AI Insights</h4>
          </div>

          {customer.feedback && (
            <div className={styles.aiSection}>
              <h5>Feedback</h5>
              <p>{customer.feedback}</p>
            </div>
          )}

          <div className={styles.aiSection}>
            <h5>Details</h5>
            <ul>
              {customer.licenseType && <li>License: {customer.licenseType}</li>}
              {customer.deploymentType && <li>Deployment: {customer.deploymentType}</li>}
              {customer.eseLead && <li>ESE Lead: {customer.eseLead}</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className={styles.cardFooter}>
        <span className={styles.metaItem}>
          Updated {customer.lastUpdated || "—"}
        </span>
        <button
          className={styles.expandBtn}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          <span className={styles.expandIcon}>▾</span>
          {expanded ? "Collapse" : "Show AI Insights"}
        </button>
      </div>
    </article>
  );
}
