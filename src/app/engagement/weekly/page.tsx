import type { Metadata } from "next";
import { WeeklyEngagementTable } from "@/components/engagement/WeeklyEngagementTable";
import type { Customer } from "@/lib/types";

export const metadata: Metadata = {
  title: "Weekly Report",
};

// TODO: Fetch week list from DynamoDB
const AVAILABLE_WEEKS = [
  "2026-01-23",
  "2026-01-15",
  "2026-01-08",
  "2025-12-18",
  "2025-12-11",
];

async function getCustomers(): Promise<Customer[]> {
  return [];
}

export default async function WeeklyReportPage() {
  const customers = await getCustomers();

  return (
    <div className="container" style={{ paddingTop: "24px", paddingBottom: "60px" }}>
      <WeeklyEngagementTable
        customers={customers}
        availableWeeks={AVAILABLE_WEEKS}
      />
    </div>
  );
}
