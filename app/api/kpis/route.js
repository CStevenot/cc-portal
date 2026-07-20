import { auth, clerkClient } from "@clerk/nextjs/server";
import { planAllowsRecordings } from "../../plans";

// Auth-gated, org-scoped KPIs. The signed-in user's ACTIVE organization determines
// which Retell agents' calls they can see. Per-org config lives in Clerk org
// publicMetadata: { agentIds: [...], includedMinutes, plan, businessName }.
export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!orgId) return Response.json({ error: "no_org" }, { status: 403 });

  const key = process.env.RETELL_API_KEY;
  if (!key) return Response.json({ error: "RETELL_API_KEY not set" }, { status: 500 });

  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });
  const meta = org.publicMetadata || {};
  const rawAgents = meta.agentIds;
  const agentIds = Array.isArray(rawAgents)
    ? rawAgents
    : typeof rawAgents === "string"
      ? rawAgents.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  const included = Number(meta.includedMinutes) || 500;
  const plan = meta.plan || "Live";
  const businessName = meta.businessName || org.name;

  try {
    const r = await fetch("https://api.retellai.com/v3/list-calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 500, sort_order: "descending" }),
    });
    if (!r.ok) return Response.json({ error: "Retell API error", status: r.status }, { status: 502 });
    let calls = await r.json();
    if (!Array.isArray(calls)) calls = calls.items || calls.calls || [];
    // Fail closed: an org with no agents configured must see NOTHING, not everything.
    // Mirrors the guard in /api/recording/[callId]. Previously this filter was simply
    // skipped when agentIds was empty, which would have shown that org every call on
    // the entire Retell account.
    if (!agentIds.length) return Response.json({ error: "no_agents" }, { status: 403 });
    calls = calls.filter((c) => agentIds.includes(c.agent_id));

    const durSec = (c) => {
      if (c.duration_ms) return c.duration_ms / 1000;
      if (c.start_timestamp && c.end_timestamp) return (c.end_timestamp - c.start_timestamp) / 1000;
      return (c.call_cost && c.call_cost.total_duration_seconds) || 0;
    };
    const cad = (c) => (c.call_analysis && c.call_analysis.custom_analysis_data) || {};
    const nameOf = (d) =>
      d.caller_name || d.business_name || [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || "";
    const callbackOf = (d) => d.best_callback_number || d.callback_number || "";
    const emailOf = (d) => d.email || d.caller_email || d.customer_email || d.contact_email || "";

    let totalSec = 0, leads = 0, appts = 0;
    const recent = [];
    for (const c of calls) {
      const s = durSec(c); totalSec += s;
      const d = cad(c);
      const outcome = (d.call_outcome || "").toLowerCase();
      const name = nameOf(d);
      const callback = callbackOf(d);
      const callerId = c.from_number || "";
      const phone = callback || callerId;
      const email = emailOf(d);
      const consentRaw = d.consent_to_text ?? d.text_consent ?? d.text_permission ?? d.sms_consent ?? d.text_ok;
      let textConsent = null;
      if (typeof consentRaw === "boolean") textConsent = consentRaw;
      else if (typeof consentRaw === "string") {
        const cs = consentRaw.trim().toLowerCase();
        if (cs && /(yes|true|grant|consent|agree|allow|\bok\b|permitted|1)/.test(cs)) textConsent = true;
        else if (cs && /(no|false|deny|declin|refus|denied|0)/.test(cs)) textConsent = false;
      }
      const isLead = !!name || !!callback || outcome.includes("lead");
      const isAppt =
        outcome.includes("book") || outcome.includes("appointment") || outcome.includes("appt") || d.booked === true;
      if (isLead) leads++;
      if (isAppt) appts++;
      if (recent.length < 100)
        recent.push({
          ts: c.start_timestamp || 0,
          name,
          phone,
          email,
          callerId,
          callback,
          textConsent,
          secs: Math.round(s),
          outcome: isAppt ? "Booked" : isLead ? "Lead captured" : s <= 8 ? "No info given" : "Handled",
          callId: c.call_id || null,
          // Whether a recording exists at all — the actual audio is only ever
          // served through /api/recording/[callId], never as a raw URL.
          hasRecording: !!(c.recording_url || c.scrubbed_recording_url),
        });
    }
    const answeredCalls = calls.filter((c) => durSec(c) > 8).length;
    return Response.json({
      plan,
      included,
      businessName,
      // Drives the dashboard: true = play buttons active, false = grayed + upsell
      canPlayRecordings: planAllowsRecordings(plan),
      calls: answeredCalls,
      minutesUsed: Math.round(totalSec / 60),
      leads,
      appointments: appts,
      avgSec: answeredCalls ? Math.round(totalSec / answeredCalls) : 0,
      recent,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
