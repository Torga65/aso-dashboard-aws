import { redirect } from "next/navigation";

/**
 * Redirect to the self-contained static suggestion-lifecycle page
 * (copied from cm-p186978-s23215-asodashboard) served from /public.
 */
export default function SuggestionLifecyclePage() {
  redirect("/suggestion-lifecycle.html");
}
