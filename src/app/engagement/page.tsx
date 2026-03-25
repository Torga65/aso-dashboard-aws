import type { Metadata } from "next";
import { WeeklyEngagementTable } from "@/components/engagement/WeeklyEngagementTable";
import { SyncStatusBanner } from "@/components/engagement/SyncStatusBanner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import {
  getCustomersByWeek,
  getAvailableWeeks,
  getLatestWeek,
  getLatestSyncJob,
} from "@/lib/queries";

export const metadata: Metadata = {
  title: "Weekly Engagement",
};

export default async function EngagementPage() {
  // Fetch week list, latest week, and sync status in parallel.
  const [weeksResult, latestWeekResult, syncJobResult] = await Promise.all([
    getAvailableWeeks(),
    getLatestWeek(),
    getLatestSyncJob(),
  ]);

  const latestWeek = latestWeekResult.data ?? "";
  const availableWeeks = weeksResult.data ?? [];

  // Fetch customers for the resolved week (only one extra RTT when data exists).
  const customersResult = latestWeek
    ? await getCustomersByWeek(latestWeek)
    : { data: [], error: null };

  return (
    <div className="container" style={{ paddingTop: "24px", paddingBottom: "60px" }}>
      <SyncStatusBanner job={syncJobResult.data ?? null} />

      {customersResult.error ? (
        <ErrorMessage
          title="Failed to load customers"
          message={customersResult.error}
        />
      ) : (
        <WeeklyEngagementTable
          customers={customersResult.data ?? []}
          week={latestWeek}
          availableWeeks={availableWeeks}
        />
      )}

      <section style={{ marginTop: "40px", paddingTop: "24px", borderTop: "1px solid #e5e7eb" }}>
        <h2>About This Data</h2>
        <p>
          This dashboard displays real customer engagement data from the AEM Sites
          Optimizer Customer Experience tracking spreadsheet.
        </p>
        <ul>
          <li>
            <strong>Data Source:</strong> SharePoint Excel file, synced daily by Lambda.
          </li>
          {availableWeeks.length > 0 && (
            <li>
              <strong>Available Weeks:</strong> {availableWeeks.length} weeks of data.
            </li>
          )}
          {latestWeek && (
            <li>
              <strong>Latest Week:</strong> {latestWeek}.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
