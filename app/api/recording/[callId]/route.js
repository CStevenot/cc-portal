import { auth, clerkClient } from "@clerk/nextjs/server";
import { planAllowsRecordings } from "../../../plans";

// Streams a call recording through our server so the raw Retell/S3 URL and the
// RETELL_API_KEY never reach the browser. Retell's recording URLs are only
// protected by link expiry, so anyone holding one could share it freely —
// proxying keeps them server-side.
//
// Three gates before any audio is returned:
//   1. signed in + has an active org
//   2. the org's plan includes recordings (Pro and above)
//   3. the requested call actually belongs to THAT org's agents
// Gate 3 is what stops one customer from guessing another customer's call IDs.

export async function GET(req, { params }) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!orgId) return Response.json({ error: "no_org" }, { status: 403 });

  const { callId } = await params;
  if (!callId || !/^[A-Za-z0-9_-]{6,128}$/.test(callId)) {
    return Response.json({ error: "bad_call_id" }, { status: 400 });
  }

  const key = process.env.RETELL_API_KEY;
  if (!key) return Response.json({ error: "RETELL_API_KEY not set" }, { status: 500 });

  try {
    const cc = await clerkClient();
    const org = await cc.organizations.getOrganization({ organizationId: orgId });
    const meta = org.publicMetadata || {};

    // Gate 2 — plan tier
    if (!planAllowsRecordings(meta.plan)) {
      return Response.json({ error: "upgrade_required" }, { status: 402 });
    }

    const rawAgents = meta.agentIds;
    const agentIds = Array.isArray(rawAgents)
      ? rawAgents
      : typeof rawAgents === "string"
        ? rawAgents.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    if (!agentIds.length) return Response.json({ error: "no_agents" }, { status: 403 });

    // Look the call up server-side and confirm ownership
    const callRes = await fetch(`https://api.retellai.com/v2/get-call/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (callRes.status === 404) return Response.json({ error: "not_found" }, { status: 404 });
    if (!callRes.ok) return Response.json({ error: "retell_error" }, { status: 502 });

    const call = await callRes.json();

    // Gate 3 — this call must belong to one of the org's agents
    if (!call.agent_id || !agentIds.includes(call.agent_id)) {
      // Deliberately 404, not 403: don't reveal that the call exists.
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Prefer the scrubbed (PII-redacted) recording when Retell provides one
    const url = call.scrubbed_recording_url || call.recording_url;
    if (!url) return Response.json({ error: "no_recording" }, { status: 404 });

    // Pass Range through so browser audio scrubbing works
    const range = req.headers.get("range");
    const upstream = await fetch(url, { headers: range ? { Range: range } : {}, cache: "no-store" });
    if (!upstream.ok && upstream.status !== 206) {
      return Response.json({ error: "fetch_failed" }, { status: 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "audio/wav");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Disposition", `inline; filename="call-${callId}.wav"`);
    for (const h of ["content-length", "content-range"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
