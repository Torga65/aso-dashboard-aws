import { redirect } from "next/navigation";

/**
 * Redirect to the self-contained static customer history page
 * (copied from cm-p186978-s23215-asodashboard) served from /public.
 */
export default function CustomerHistoryPage() {
  redirect("/customer-history.html");
}
