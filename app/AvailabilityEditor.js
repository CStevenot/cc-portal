"use client";

import { useEffect, useMemo, useState } from "react";

const DAYS = [
  { k: "mon", label: "Monday" },
  { k: "tue", label: "Tuesday" },
  { k: "wed", label: "Wednesday" },
  { k: "thu", label: "Thursday" },
  { k: "fri", label: "Friday" },
  { k: "sat", label: "Saturday" },
  { k: "sun", label: "Sunday" },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const toMin = (t) => {
  const [h, m] = (t || "0:00").split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m) => {
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm}${ampm}`;
};

// Mirrors what the AI will be offered: walk the window in slot+buffer steps.
function slotsFor(day, slotMinutes, bufferMinutes, maxPerDay) {
  if (!day || !day.open) return [];
  const out = [];
  const end = toMin(day.end);
  const step = Math.max(15, Number(slotMinutes) + Number(bufferMinutes));
  for (let t = toMin(day.start); t + Number(slotMinutes) <= end; t += step) {
    out.push(fromMin(t));
    if (out.length >= Number(maxPerDay)) break;
  }
  return out;
}

export default function AvailabilityEditor() {
  const [cfg, setCfg] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newBlackout, setNewBlackout] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/availability")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (!alive) return;
        setCfg(d.availability);
        setState("ok");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  function patch(next) {
    setCfg((c) => ({ ...c, ...next }));
    setMsg(null);
  }
  function patchDay(k, next) {
    setCfg((c) => ({ ...c, days: { ...c.days, [k]: { ...c.days[k], ...next } } }));
    setMsg(null);
  }
  function addBlackout() {
    const d = newBlackout.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (cfg.blackouts.includes(d)) return setNewBlackout("");
    patch({ blackouts: [...cfg.blackouts, d].sort() });
    setNewBlackout("");
  }
  function removeBlackout(d) {
    patch({ blackouts: cfg.blackouts.filter((x) => x !== d) });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({
          type: "err",
          text: d.error === "admin_only" ? "Only an admin can change availability." : "Couldn't save — try again.",
        });
      } else {
        setCfg(d.availability);
        setMsg({ type: "ok", text: "Saved. Your AI will only book inside these hours." });
      }
    } catch {
      setMsg({ type: "err", text: "Couldn't save — try again." });
    }
    setSaving(false);
  }

  const preview = useMemo(() => {
    if (!cfg) return null;
    const firstOpen = DAYS.find((d) => cfg.days[d.k] && cfg.days[d.k].open);
    if (!firstOpen) return { label: null, slots: [] };
    return {
      label: firstOpen.label,
      slots: slotsFor(cfg.days[firstOpen.k], cfg.slotMinutes, cfg.bufferMinutes, cfg.maxPerDay),
    };
  }, [cfg]);

  if (state === "error")
    return (
      <div className="wrap">
        <div className="err">We couldn&apos;t load your availability just now. Try refreshing in a minute.</div>
      </div>
    );
  if (state === "loading" || !cfg)
    return (
      <div className="wrap">
        <div className="notice">Loading your availability…</div>
      </div>
    );

  return (
    <div className="wrap">
      <h2 className="pagetitle">Availability</h2>
      <p className="pagesub">
        Set the hours your AI is allowed to book estimates and appointments. It will never offer a time outside these
        windows — and once your calendar is connected, it also skips anything already booked.
      </p>

      <div className="sec avsec">
        <h3>Weekly hours</h3>
        <div className="daylist">
          {DAYS.map(({ k, label }) => {
            const d = cfg.days[k];
            return (
              <div className={"dayrow" + (d.open ? "" : " off")} key={k}>
                <label className="daytoggle">
                  <input type="checkbox" checked={d.open} onChange={(e) => patchDay(k, { open: e.target.checked })} />
                  <span>{label}</span>
                </label>
                {d.open ? (
                  <div className="times">
                    <input type="time" value={d.start} onChange={(e) => patchDay(k, { start: e.target.value })} />
                    <span className="to">to</span>
                    <input type="time" value={d.end} onChange={(e) => patchDay(k, { end: e.target.value })} />
                  </div>
                ) : (
                  <span className="closed">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sec avsec">
        <h3>Booking rules</h3>
        <div className="rulegrid">
          <label className="rule">
            <span className="rlab">Appointment length</span>
            <select value={cfg.slotMinutes} onChange={(e) => patch({ slotMinutes: Number(e.target.value) })}>
              {[30, 45, 60, 90, 120, 180].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <label className="rule">
            <span className="rlab">Buffer between jobs</span>
            <select value={cfg.bufferMinutes} onChange={(e) => patch({ bufferMinutes: Number(e.target.value) })}>
              {[0, 15, 30, 45, 60].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <label className="rule">
            <span className="rlab">Max bookings per day</span>
            <input
              type="number"
              min="1"
              max="50"
              value={cfg.maxPerDay}
              onChange={(e) => patch({ maxPerDay: Number(e.target.value) })}
            />
          </label>
          <label className="rule">
            <span className="rlab">Earliest booking</span>
            <select value={cfg.leadHours} onChange={(e) => patch({ leadHours: Number(e.target.value) })}>
              {[0, 1, 2, 4, 12, 24, 48].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Anytime" : `${n}+ hours out`}
                </option>
              ))}
            </select>
          </label>
          <label className="rule">
            <span className="rlab">Time zone</span>
            <select value={cfg.timezone} onChange={(e) => patch({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("America/", "").replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="sec avsec">
        <h3>Days off</h3>
        <p className="hint">Holidays or vacation days the AI should never book.</p>
        <div className="blackrow">
          <input type="date" value={newBlackout} onChange={(e) => setNewBlackout(e.target.value)} />
          <button className="btn ghost" onClick={addBlackout} disabled={!newBlackout}>
            Add day off
          </button>
        </div>
        {cfg.blackouts.length > 0 && (
          <div className="chips">
            {cfg.blackouts.map((d) => (
              <span className="chip" key={d}>
                {d}
                <button onClick={() => removeBlackout(d)} aria-label={"Remove " + d}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div className="sec avsec">
          <h3>What your AI will offer</h3>
          {preview.slots.length ? (
            <>
              <p className="hint">
                Example — a typical {preview.label}, before your calendar&apos;s booked times are removed:
              </p>
              <div className="chips">
                {preview.slots.map((s) => (
                  <span className="chip slot" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">No open days yet — turn on at least one day above.</p>
          )}
        </div>
      )}

      <div className="saverow">
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save availability"}
        </button>
        {msg && <span className={"savemsg " + (msg.type === "ok" ? "ok" : "bad")}>{msg.text}</span>}
      </div>

      <div className="foot">Client Connected · availability</div>
    </div>
  );
}
