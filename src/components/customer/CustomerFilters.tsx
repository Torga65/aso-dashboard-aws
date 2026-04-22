"use client";

import styles from "./CustomerFilters.module.css";

export interface FilterState {
  search: string;
  status: string;
  engagement: string;
}

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

export function CustomerFilters({ filters, onChange }: Props) {
  function set(key: keyof FilterState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className={styles.bar}>
      <div className={styles.searchWrap}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search customers…"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          aria-label="Search customers"
        />
      </div>

      <select
        className={styles.select}
        value={filters.status}
        onChange={(e) => set("status", e.target.value)}
        aria-label="Filter by status"
      >
        <option value="">All Statuses</option>
        <option value="Active">Active</option>
        <option value="At-Risk">At-Risk</option>
        <option value="Onboarding">Onboarding</option>
        <option value="Pre-Production">Pre-Production</option>
        <option value="Churned">Churned</option>
        <option value="On-Hold">On-Hold</option>
      </select>

      <select
        className={styles.select}
        value={filters.engagement}
        onChange={(e) => set("engagement", e.target.value)}
        aria-label="Filter by engagement"
      >
        <option value="">All Engagement</option>
        <option value="High">High</option>
        <option value="Medium">Medium</option>
        <option value="Low">Low</option>
        <option value="Unknown">Unknown</option>
      </select>

    </div>
  );
}
