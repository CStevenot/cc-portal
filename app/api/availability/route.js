import { auth, clerkClient } from "@clerk/nextjs/server";

// Per-org booking availability. Small, non-secret config -> lives in Clerk org
// publicMetadata.availability. (OAuth tokens + bookings go in Postgres in Phase 1.)
//
// GET  -> current config (or defaults if never set)
// POST -> save config (admins only)

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

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

const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clamp = (n, lo, hi, dflt) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};

// Never trust the client: rebuild the object field by field.
function sanitize(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {
    timezone: typeof src.timezone === "string" && src.timezone.length < 64 ? src.timezone : DEFAULTS.timezone,
    slotMinutes: clamp(src.slotMinutes, 15, 480, DEFAULTS.slotMinutes),
    bufferMinutes: clamp(src.bufferMinutes, 0, 240, DEFAULTS.bufferMinutes),
    maxPerDay: clamp(src.maxPerDay, 1, 50, DEFAULTS.maxPerDay),
    leadHours: clamp(src.leadHours, 0, 168, DEFAULTS.leadHours),
    days: {},
    blackouts: [],
  };

  for (const k of DAY_KEYS) {
    const d = (src.days && src.days[k]) || {};
    const start = isTime(d.start) ? d.start : DEFAULTS.days[k].start;
    let end = isTime(d.end) ? d.end : DEFAULTS.days[k].end;
    // end must be after start; if not, fall back to the default window
    if (end <= start) end = DEFAULTS.days[k].end > start ? DEFAULTS.days[k].end : "23:59";
    out.days[k] = { open: !!d.open, start, end };
  }

  if (Array.isArray(src.blackouts)) {
    out.blackouts = [...new Set(src.blackouts.filter(isDate))].sort().slice(0, 200);
  }

  return out;
}

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!orgId) return Response.json({ error: "no_org" }, { status: 403 });

  try {
    const cc = await clerkClient();
    const org = await cc.organizations.getOrganization({ organizationId: orgId });
    const saved = org.publicMetadata && org.publicMetadata.availability;
    return Response.json({
      availability: saved ? sanitize(saved) : DEFAULTS,
      isDefault: !saved,
      businessName: (org.publicMetadata && org.publicMetadata.businessName) || org.name,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!orgId) return Response.json({ error: "no_org" }, { status: 403 });
  if (orgRole !== "org:admin") {
    return Response.json({ error: "admin_only" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const clean = sanitize(body);

  try {
    const cc = await clerkClient();
    const org = await cc.organizations.getOrganization({ organizationId: orgId });
    await cc.organizations.updateOrganizationMetadata(orgId, {
      publicMetadata: { ...(org.publicMetadata || {}), availability: clean },
    });
    return Response.json({ ok: true, availability: clean });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
