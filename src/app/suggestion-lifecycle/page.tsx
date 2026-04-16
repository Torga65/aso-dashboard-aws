import StaticPageFrame from "@/components/layout/StaticPageFrame";

interface Props {
  searchParams: Promise<{ customer?: string }>;
}

export default async function SuggestionLifecyclePage({ searchParams }: Props) {
  const { customer } = await searchParams;
  const src = customer
    ? `/suggestion-lifecycle.html?customer=${encodeURIComponent(customer)}`
    : "/suggestion-lifecycle.html";
  return <StaticPageFrame src={src} title="Suggestions Lifecycle" />;
}
