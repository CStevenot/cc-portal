// Order lookup helpers (pure).
export const digits = (s) => (s || "").replace(/\D/g, "");
const norm = (s) => (s || "").trim().toLowerCase();

export function contactMatches(given, email, phone) {
  const g = norm(given);
  if (!g) return false;
  if (g.includes("@")) return !!email && norm(email) === g;
  const gd = digits(g).slice(-10);
  return gd.length === 10 && !!phone && digits(phone).slice(-10) === gd;
}

export function mapStatus(o) {
  const fs = String(o.displayFulfillmentStatus || "");
  const ship = (o.fulfillments || []).map((f) => String(f.displayStatus || ""));
  if (ship.includes("DELIVERED")) return "delivered";
  if (fs === "FULFILLED" || fs === "PARTIALLY_FULFILLED" || ship.length) return "in_transit";
  if (fs) return "not_shipped";
  return "unknown";
}
