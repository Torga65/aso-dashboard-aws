import type { Metadata } from "next";
import CustomerStatusDashboard from "@/components/reports/CustomerStatusDashboard";

export const metadata: Metadata = {
  title: "Customer Status",
};

export default function ReportsPage() {
  return <CustomerStatusDashboard />;
}
