import type { Metadata } from "next";
import { CustomerHistoryTable } from "@/components/customer/CustomerHistoryTable";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getLatestWeek, getCustomersByWeek } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Customer History",
};

/**
 * Customer History page.
 *
 * The CustomerHistoryTable filters a flat Customer[] by selected company to
 * build a timeline.  On initial load we pass the latest week's snapshots so
 * users can select a company and see at least one week of data immediately.
 *
 * Full cross-week timelines are available via the "Customer History" secondary
 * index query (getCustomerHistory) which is exposed for use from Client
 * Components via the data layer when a company-specific deep-dive is needed.
 */
export default async function CustomerHistoryPage() {
  const latestWeekResult = await getLatestWeek();
  const latestWeek = latestWeekResult.data ?? "";

  const customersResult = latestWeek
    ? await getCustomersByWeek(latestWeek)
    : { data: [], error: null };

  if (customersResult.error) {
    return (
      <div className="container" style={{ paddingTop: "24px", paddingBottom: "60px" }}>
        <h1>Customer History</h1>
        <ErrorMessage
          title="Failed to load customer data"
          message={customersResult.error}
        />
      </div>
    );
  }

  const customers = customersResult.data ?? [];

  return (
    <div className="container" style={{ paddingTop: "24px", paddingBottom: "60px" }}>
      <h1>Customer History</h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>
        Historical analysis of customer data across all columns and weeks.
        Select a customer to view their full timeline.
      </p>

      {customers.length === 0 ? (
        <EmptyState
          title="No customer data yet"
          message="Data will appear here once the daily sync Lambda has run."
          icon="📊"
        />
      ) : (
        <CustomerHistoryTable customers={customers} />
      )}
    </div>
  );
}
