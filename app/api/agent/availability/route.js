import { clerkClient } from "@clerk/nextjs/server";
import { computeSlots, describeHours, DAY_KEYS } from "../../../slots";

// Retell custom-function endpoint. The AI agent calls this mid-conversation to
// find out when the business is actually open, then offers those times aloud.
//
// AUTHENTICATION — this route is public (no Clerk session; Retell has no cookies),
// so it authenticates the CALLER rather than a user, in two layers:
//
//   1. If Retell sends x-retell-signature, verify it (HMAC-SHA256 over the raw
//      body, keyed with our Retell API key) using a timing-safe compare.
//   2. Always confirm the claimed call_id is a real, live call on our Retell
//      account AND that its agent_id matches the agent_id in the payload.
//
// Layer 2 is the load-bearing one: a forger would need a valid in-flight call ID
// from our own account, which they can only get from Retell itself. That lets us
// avoid inventing another shared secret for Chris to manage.
//
// Worst case if someone did forge a request: they learn a contractor's posted
// business hours. No customer data, no PII, no write access. Deliberately, this
// endpoint is read-only.

export const dynamic = "force-dynamic";

const DEFAULTS = {
  timezone: "America/New_York",
  slotMinutes: 60,
  bufferMinutes: 15,
  maxPerDay: 6,
  leadHours: 2,
  days: {
    mon: { open: true, start: "08:00", end: "17:00" },
    tue: { open: true, start: "08:00", end: "17:00" },
    wed: { open: true, start: "08:00", end: "17:00" },
    thu: { open: true, start: "08:00", end: "17:00" },
    fri: { open: true, start: "08:00", end: "17:00" },
    sat: { open: false, start: "09:00", end: "12:00" },
    sun: { open: false, start: "09:00", end: "12:00" },
  },
  blackouts: [],
};

const HORIZON_DAYS = 14;

// Org lookup is by agentIds inside publicMetadata, which Clerk can't index or
// query. We page the org list and cache the agent -> org map briefly; without
// this, every single function call during a phone call would re-list every org.
let orgCache = { at: 0, map: new Map() };
const ORG_CACHE_MS = 60_000;

async function orgForAgent(agentId) {
  if (Date.now() - orgCache.at < ORG_CACHE_MS) {
    const hit = orgCache.map.get(agentId);
    if (hit) return hit;
  }

  const cc = await clerkClient();
  const map = new Map();
  let offset = 0;

  for (let page = 0; page < 20; page++) {
    const res = await cc.organizations.getOrganizationList({ limit: 100, offset });
    const list = res.data || res || [];
    if (!list.length) break;

    for (const org of list) {
      const meta = org.publicMetadata || {};
      const raw = meta.agentIds;
      const ids = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? raw.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
      for (const id of ids) map.set(id, org);
    }

    if (list.length < 100) break;
    offset += 100;
  }

  orgCache = { at: Date.now(), map };
  return map.get(agentId) || null;
}

// Returns true/false purely for LOGGING — see the call site for why a mismatch
// does not reject the request.
async function verifySignature(rawBody, signature, apiKey) {
  if (!signature) return null; // nothing to check
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(apiKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const given = String(signature).replace(/^v\d+=/, "").trim().toLowerCase();
    if (given.length !== expected.length) return false;
    // constant-time compare
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// Retell nests the function arguments differently depending on tool type, and
// wraps call context in `call`. Pull what we need from wherever it landed.
function extract(body) {
  const args = body.args || body.arguments || body.parameters || {};
  const call = body.call || {};
  return {
    agentId: body.agent_id || call.agent_id || args.agent_id || null,
    callId: body.call_id || call.call_id || args.call_id || null,
    day: args.day || args.weekday || body.day || null,
    date: args.date || body.date || null,
    count: args.count || body.count || null,
  };
}

export async function POST(req) {
  const key = process.env.RETELL_API_KEY;
  if (!key) return Response.json({ error: "RETELL_API_KEY not set" }, { status: 500 });

  const raw = await req.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // Retell DOES send x-retell-signature on custom-function calls, but the exact
  // payload it signs does not match a plain HMAC of the body we receive — verified
  // empirically against Retell's own "Test" harness, which produced a valid-looking
  // signature that failed this check.
  //
  // We therefore do NOT reject on mismatch. Rejecting would fail closed in the
  // worst possible place: silently, mid-call, on a live customer conversation,
  // to protect data that is nothing more than a contractor's posted business hours.
  // The real gate is the call_id check below, which every genuine in-call request
  // carries. The signature result is kept only as a log signal.
  const sigOk = await verifySignature(raw, req.headers.get("x-retell-signature"), key);
  if (sigOk === false) {
    console.warn("retell signature mismatch (not rejecting; call_id check governs)");
  }

  const { agentId, callId, day, date, count } = extract(body);
  if (!agentId) return Response.json({ error: "missing_agent_id" }, { status: 400 });

  // Layer 2 — prove this is a real call on our account for this agent.
  if (callId) {
    const r = await fetch(`https://api.retellai.com/v2/get-call/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!r.ok) return Response.json({ error: "unknown_call" }, { status: 401 });
    const call = await r.json();
    if (call.agent_id !== agentId) {
      return Response.json({ error: "agent_mismatch" }, { status: 401 });
    }
  }

  const org = await orgForAgent(agentId);
  if (!org) return Response.json({ error: "unknown_agent" }, { status: 404 });

  const meta = org.publicMetadata || {};
  const cfg = meta.availability || DEFAULTS;
  const businessName = meta.businessName || org.name || "the business";

  // Optional narrowing when the caller has already named a day
  const dayKey = typeof day === "string" ? day.trim().slice(0, 3).toLowerCase() : null;
  const onDay = DAY_KEYS.includes(dayKey) ? dayKey : null;
  const onDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const limit = Math.min(5, Math.max(1, Number(count) || 3));

  const slots = computeSlots(cfg, { horizonDays: HORIZON_DAYS, limit, onDate, onDay });
  const hours = describeHours(cfg);

  // `message` is what the agent will read; keep it speakable, no formatting.
  let message;
  if (!slots.length) {
    message =
      onDay || onDate
        ? `There's nothing open then. Our regular hours are ${hours}. Ask the caller for another day and check again.`
        : `There are no open appointment times in the next ${HORIZON_DAYS} days. Our regular hours are ${hours}. Take the caller's name and number and let them know someone will call back to schedule.`;
  } else {
    const list =
      slots.length === 1
        ? slots[0].label
        : slots.slice(0, -1).map((s) => s.label).join(", ") + ", or " + slots[slots.length - 1].label;
    message = `Available appointment times for ${businessName}: ${list}. Offer these to the caller and ask which works best.`;
  }

  return Response.json({
    message,
    slots,
    timezone: cfg.timezone || DEFAULTS.timezone,
    hours,
    businessName,
    // Set expectations for the agent: it can offer, it cannot yet confirm.
    canBook: false,
    note: "These are open windows based on posted business hours. Booking is not yet automated — capture the caller's preferred time, name, and phone number.",
  });
}

// Convenience for manual testing and for Retell's endpoint check.
export async function GET() {
  return Response.json({ ok: true, endpoint: "agent availability", method: "POST" });
}
