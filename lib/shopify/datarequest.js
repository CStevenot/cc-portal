// customers/data_request: assemble what we hold about one shopper so the merchant
// can answer them. We hold no Shopify data; only Retell call records (90 days).
import { matchesCustomer } from "./retell";

export function buildDataReport({ shop, requestId, customer, calls }) {
  const lines = [
    `Shopify data request ${requestId || "(no id)"} from ${shop}`,
    `Customer id: ${customer?.id ?? "unknown"}`,
    `Respond to the merchant within 30 days of the request.`,
    ``,
    `Client Connected stores no Shopify order data. Matching phone-call records (kept 90 days):`,
    `Matching calls: ${calls.length}`,
    ``,
  ];
  for (const c of calls) {
    lines.push(
      `--- Call ${c.call_id}`,
      `Date: ${c.start_timestamp ? new Date(c.start_timestamp).toISOString() : "unknown"}`,
      `From number: ${c.from_number || "unknown"}`,
      `Contact given: ${c.collected_dynamic_variables?.customer_contact || "none"}`,
      `Recording on file: ${c.recording_url || c.scrubbed_recording_url ? "yes" : "no"}`,
      `Transcript:`,
      (c.transcript || "(none)").slice(0, 20000),
      ``
    );
  }
  return lines.join("\n");
}

export function callsForCustomer(calls, customer) {
  const emails = [customer?.email].filter(Boolean);
  const phones = [customer?.phone].filter(Boolean);
  if (!emails.length && !phones.length) return [];
  return calls.filter((c) => matchesCustomer(c, emails, phones));
}
