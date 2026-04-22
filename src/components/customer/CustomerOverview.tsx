"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@/lib/types";
import { CustomerCard } from "./CustomerCard";
import { CustomerFilters, type FilterState } from "./CustomerFilters";
import styles from "./CustomerOverview.module.css";

interface Props {
  customers: Customer[];
  week?: string;
}

const DEFAULT_FILTERS: FilterState = {
  search: "",
  status: "",
  engagement: "",
};

export function CustomerOverview({ customers, week }: Props) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // Derive stats from the full unfiltered set
  const stats = useMemo(() => {
    const active = customers.filter((c) =>
      c.status.toLowerCase() === "active"
    ).length;
    const atRisk = customers.filter((c) =>
      c.status.toLowerCase() === "at-risk"
    ).length;
    return { total: customers.length, active, atRisk };
  }, [customers]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = customers;
    const q = filters.search.toLowerCase();

    if (q) {
      list = list.filter(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          c.summary?.toLowerCase().includes(q)
      );
    }
    if (filters.status) {
      list = list.filter(
        (c) => c.status.toLowerCase() === filters.status.toLowerCase()
      );
    }
    if (filters.engagement) {
      list = list.filter(
        (c) => c.engagement.toLowerCase() === filters.engagement.toLowerCase()
      );
    }
    return list;
  }, [customers, filters]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Customer Engagement Overview</h2>
          {week && (
            <p className={styles.subtitle}>Week of {week}</p>
          )}
        </div>

        {/* Summary stats */}
        <div className={styles.stats}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statLabel}>Total Customers</div>
          </div>
          <div className={`${styles.statCard} ${styles.statGreen}`}>
            <div className={styles.statValue}>{stats.active}</div>
            <div className={styles.statLabel}>Active</div>
          </div>
          <div className={`${styles.statCard} ${styles.statYellow}`}>
            <div className={styles.statValue}>{stats.atRisk}</div>
            <div className={styles.statLabel}>At-Risk</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <CustomerFilters filters={filters} onChange={setFilters} />

      {/* Results count */}
      <p className={styles.resultCount}>
        {filtered.length === customers.length
          ? `${customers.length} customers`
          : `${filtered.length} of ${customers.length} customers`}
      </p>

      {/* Grid */}
      {customers.length === 0 ? (
        <div className={styles.empty}>
          No customer data available. Connect the data source to populate this view.
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>No customers match the current filters.</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((customer) => (
            <CustomerCard
              key={`${customer.companyName}-${customer.week}`}
              customer={customer}
            />
          ))}
        </div>
      )}
    </div>
  );
}
