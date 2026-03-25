"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EngagementBadge } from "@/components/ui/EngagementBadge";
import { HealthBar } from "@/components/ui/HealthBar";
import styles from "./WeeklyEngagementTable.module.css";

interface Props {
  customers: Customer[];
  week?: string;
  availableWeeks?: string[];
}

export function WeeklyEngagementTable({ customers, week, availableWeeks = [] }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [engagementFilter, setEngagementFilter] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(week ?? "");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customers.filter((c) => {
      if (selectedWeek && c.week !== selectedWeek) return false;
      if (q && !c.companyName.toLowerCase().includes(q)) return false;
      if (statusFilter && c.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (engagementFilter && c.engagement.toLowerCase() !== engagementFilter.toLowerCase())
        return false;
      return true;
    });
  }, [customers, search, statusFilter, engagementFilter, selectedWeek]);

  const latestWeek = useMemo(() => {
    const weeks = [...new Set(customers.map((c) => c.week))].sort().reverse();
    return weeks[0] ?? "";
  }, [customers]);

  const displayWeek = selectedWeek || latestWeek;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.weekInfo}>
          <h2 className={styles.weekTitle}>Weekly Engagement Report</h2>
          {displayWeek && (
            <p className={styles.weekSubtitle}>Week of {displayWeek}</p>
          )}
        </div>
        <span className={styles.count}>{filtered.length} customers</span>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.searchWrap}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
        </div>

        {availableWeeks.length > 0 && (
          <select
            className={styles.select}
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            aria-label="Select week"
          >
            <option value="">Latest week</option>
            {availableWeeks.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        )}

        <select
          className={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="At-Risk">At-Risk</option>
          <option value="Onboarding">Onboarding</option>
          <option value="Pre-Production">Pre-Production</option>
          <option value="Churned">Churned</option>
        </select>

        <select
          className={styles.select}
          value={engagementFilter}
          onChange={(e) => setEngagementFilter(e.target.value)}
          aria-label="Filter by engagement"
        >
          <option value="">All Engagement</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
          <option value="Unknown">Unknown</option>
        </select>
      </div>

      {/* Table */}
      {customers.length === 0 ? (
        <p className={styles.empty}>
          No engagement data available. Connect the data source to populate this view.
        </p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No customers match the current filters.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Engagement</th>
                <th className={styles.healthCol}>Health Score</th>
                <th className={styles.summaryCol}>Summary</th>
                <th className={styles.blockersCol}>Blockers</th>
                <th className={styles.feedbackCol}>Feedback</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const key = `${c.companyName}-${c.week}`;
                const isExpanded = expandedRow === key;
                return (
                  <tr
                    key={key}
                    className={isExpanded ? styles.expandedRow : ""}
                    onClick={() => setExpandedRow(isExpanded ? null : key)}
                    aria-expanded={isExpanded}
                  >
                    <td className={styles.companyCell}>
                      <strong>{c.companyName}</strong>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      <EngagementBadge level={c.engagement} />
                    </td>
                    <td className={styles.healthCol}>
                      <HealthBar score={c.healthScore} />
                    </td>
                    <td className={`${styles.summaryCol} ${styles.summaryCell}`}>
                      {c.summary || "—"}
                    </td>
                    <td className={styles.blockersCol}>
                      {c.blockers && c.blockers !== "None" ? c.blockers : "—"}
                    </td>
                    <td className={styles.feedbackCol}>
                      {c.feedback || "—"}
                    </td>
                    <td className={styles.dateCell}>{c.lastUpdated || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
