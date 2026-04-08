import StaticPageFrame from "@/components/layout/StaticPageFrame";

interface Props {
  searchParams: Promise<{ customer?: string }>;
}

export default async function CustomerEditPage({ searchParams }: Props) {
  const { customer } = await searchParams;
  const src = customer
    ? `/customer-history-edit.html?customer=${encodeURIComponent(customer)}`
    : "/customer-history-edit.html";
  return <StaticPageFrame src={src} title="Add / Edit Customer" />;
}
