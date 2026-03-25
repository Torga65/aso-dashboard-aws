import type { Metadata } from "next";
import { SuggestionLifecycleView } from "@/components/suggestions/SuggestionLifecycleView";

export const metadata: Metadata = { title: "Suggestion Lifecycle" };

export default function SuggestionLifecyclePage() {
  return <SuggestionLifecycleView />;
}
