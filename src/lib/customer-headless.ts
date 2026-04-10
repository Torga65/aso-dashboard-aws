import type { Customer } from "@/lib/types";

function customFieldRaw(
  cf: Customer["customFields"],
  key: string
): unknown {
  if (!cf || typeof cf !== "object") return undefined;
  const rec = cf as Record<string, unknown>;
  const v = rec[key] ?? rec[key.charAt(0).toUpperCase() + key.slice(1)];
  if (v == null) return undefined;
  if (typeof v === "object" && v !== null && "value" in v) {
    return (v as { value: unknown }).value;
  }
  return v;
}

/** True if the customer record is marked headless (custom field and/or deployment type). */
export function isCustomerHeadless(c: Customer): boolean {
  const dt = (c.deploymentType || "").toLowerCase();
  if (dt.includes("headless")) return true;

  const raw = customFieldRaw(c.customFields, "headless");
  if (raw == null || raw === "") return false;
  const s = String(raw).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}
