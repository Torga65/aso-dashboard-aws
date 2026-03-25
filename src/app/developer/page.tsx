import type { Metadata } from "next";
import { DeveloperView } from "@/components/developer/DeveloperView";

export const metadata: Metadata = { title: "Developer" };

export default function DeveloperPage() {
  return <DeveloperView />;
}
