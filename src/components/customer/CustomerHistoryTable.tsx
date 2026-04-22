"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EngagementBadge } from "@/components/ui/EngagementBadge";
import styles from "./CustomerHistoryTable.module.css";

interface Props {
  customers: Customer[];
}

export function CustomerHistoryTable({ customers }: Props) {
  const [selectedCompany, setSelectedCompany] = useState("");

  // Unique company names sorted alphabetically
  const companies = useMemo(() => {
    const names = [...new Set(customers.map((c) => c.companyName))].sort();
    return names;
  }, [customers]);

  // Timeline for selected company, sorted oldest → newest
  const timeline = useMemo(() => {
    if (!selectedCompany) return [];
    return customers
      .filter((c) => c.companyName === selectedCompany)
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [customers, selectedCompany]);

  return (
    <div className={styles.container}>
      {/* Company selector */}
      <div className={styles.selectorWrap}>
        <label htmlFor="company-select" className={styles.selectorLabel}>
          Select Customer
        </label>
        <select
          id="company-select"
          className={styles.selector}
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
        >
          <option value="">— Choose a customer —</option>
          {companies.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {customers.length === 0 ? (
        <p className={styles.empty}>
          No customer data available. Connect the data source to populate this
          view.
        </p>
      ) : !selectedCompany ? (
        <p className={styles.hint}>
          Select a customer above to view their history across all weeks.
        </p>
      ) : timeline.length === 0 ? (
        <p className={styles.empty}>No history found for {selectedCompany}.</p>
      ) : (
        <>
          <h2 className={styles.companyTitle}>{selectedCompany}</h2>
          <p className={styles.weekCount}>
            {timeline.length} week{timeline.length !== 1 ? "s" : ""} of data
          </p>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Status</th>
                  <th>Engagement</th>
                  <th className={styles.summaryCol}>Summary</th>
                  <th className={styles.blockersCol}>Blockers</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row) => {
                  return (
                    <tr key={row.week}>
                      <td className={styles.weekCell}>{row.week}</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td>
                        <EngagementBadge level={row.engagement} />
                      </td>
                      <td className={styles.summaryCol}>
                        {row.summary || "—"}
                      </td>
                      <td className={styles.blockersCol}>
                        {row.blockers && row.blockers !== "None"
                          ? row.blockers
                          : "—"}
                      </td>
                      <td className={styles.dateCell}>{row.lastUpdated || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
