import type { Metadata } from "next";
import { Hero } from "@/components/sections/Hero";
import { QuickLinks, type QuickLink } from "@/components/sections/QuickLinks";
import { CustomerOverview } from "@/components/customer/CustomerOverview";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { getCustomersByWeek, getLatestWeek } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Customer Overview",
};

const QUICK_LINKS: QuickLink[] = [
  {
    title: "Detailed Table View",
    description:
      "View all customers in a detailed table with advanced filtering and search capabilities.",
    href: "/engagement",
    cta: "View Table →",
  },
  {
    title: "Weekly Reports",
    description:
      "Access historical weekly engagement reports and track customer progress over time.",
    href: "/engagement/weekly",
    cta: "View Reports →",
  },
  {
    title: "Customer History",
    description:
      "Historical analysis of customer data across all columns and weeks.",
    href: "/customer-history",
    cta: "View History →",
  },
];

export default async function HomePage() {
  const latestWeekResult = await getLatestWeek();
  const latestWeek = latestWeekResult.data ?? "";

  const customersResult = latestWeek
    ? await getCustomersByWeek(latestWeek)
    : { data: [], error: null };

  return (
    <>
      <Hero
        title="🎯 AEM Sites Optimizer"
        subtitle="Customer Engagement Dashboard"
      />

      <div className="container">
        {customersResult.error ? (
          <ErrorMessage
            title="Failed to load customer data"
            message={customersResult.error}
          />
        ) : (
          <CustomerOverview
            customers={customersResult.data ?? []}
            week={latestWeek}
          />
        )}
      </div>

      <QuickLinks links={QUICK_LINKS} />

      <section className="section light">
        <div className="section-inner">
          <h2>About the Dashboard</h2>
          <p>
            This dashboard provides real-time visibility into AEM Sites Optimizer
            customer engagement across your portfolio. Key features:
          </p>
          <ul>
            <li>
              <strong>Real-time Data:</strong> Automatically loads the latest
              customer data from SharePoint via daily Lambda sync.
            </li>
            <li>
              <strong>Health Scoring:</strong> Calculated from engagement,
              blockers, feedback, and overall health indicators.
            </li>
            <li>
              <strong>Advanced Filtering:</strong> Search by name, filter by
              status, engagement level, or health score.
            </li>
            <li>
              <strong>Week Navigation:</strong> Displays current week or navigate
              to specific historical weeks.
            </li>
            <li>
              <strong>Responsive Design:</strong> Works seamlessly on desktop,
              tablet, and mobile devices.
            </li>
          </ul>

          <h3>Data Sources</h3>
          <p>
            <strong>Source File:</strong>{" "}
            <code>AEM_Sites_Optimizer-CustomerExperience.xlsx</code> (SharePoint)
          </p>
          {latestWeek && (
            <p>
              <strong>Latest Week:</strong> {latestWeek}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
