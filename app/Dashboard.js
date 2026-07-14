"use client";

import { useEffect, useMemo, useState } from "react";

const COLS = [
  { k: "ts", label: "Date & Time" },
  { k: "name", label: "Name" },
  { k: "callerId", label: "Caller ID" },
  { k: "callback", label: "Phone Provided" },
  { k: "_match", label: "Match", ctr: true },
  { k: "_text", label: "Texts OK", ctr: true },
  { k: "email", label: "Email" },
  { k: "secs", label: "Length" },
  { k: "outcome", label: "Outcome" },
];
const COLKEYS = COLS.map((c) => c.k);
const colDef = (k) => COLS.find((c) => c.k === k);

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const digits10 = (s) => (s || "").replace(/\D/g, "").slice(-10);
const fmtTime = (r) =>
  r.ts
    ? new Date(r.ts).toLocaleString([], {
        month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit",
      })
    : "";
function matchState(a, b) {
  const x = digits10(a), y = digits10(b);
  if (y.length < 10) return "";
  return x.length >= 10 && x === y ? "match" : "mismatch";
}
function tagClass(o) {
  o = (o || "").toLowerCase();
  return o.includes("book") ? "booked" : o.includes("lead") ? "lead" : "missed";
}

function loadPrefs() {
  try {
    const p = JSON.parse((typeof window !== "undefined" && localStorage.getItem("cc_table_prefs")) || "{}");
    let order = Array.isArray(p.order) ? p.order.filter((k) => COLKEYS.includes(k)) : COLKEYS.slice();
    COLKEYS.forEach((k) => { if (!order.includes(k)) order.push(k); });
    const hidden = Array.isArray(p.hidden) ? p.hidden.filter((k) => COLKEYS.includes(k)) : [];
    return { order, hidden };
  } catch {
    return { order: COLKEYS.slice(), hidden: [] };
  }
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "ts", dir: -1 });
  const [prefs, setPrefs] = useState({ order: COLKEYS.slice(), hidden: [] });
  const [cfgOpen, setCfgOpen] = useState(false);

  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    let alive = true;
    fetch("/api/kpis")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!alive) return; if (d.error) throw 0; setData(d); setState("ok"); })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  function savePrefs(next) {
    setPrefs(next);
    try { localStorage.setItem("cc_table_prefs", JSON.stringify(next)); } catch {}
  }
  const visible = prefs.order.filter((k) => !prefs.hidden.includes(k));
  function toggleCol(k) {
    const hidden = prefs.hidden.includes(k)
      ? prefs.hidden.filter((x) => x !== k)
      : visible.length <= 1 ? prefs.hidden : [...prefs.hidden, k];
    savePrefs({ ...prefs, hidden });
  }
  function moveCol(k, dir) {
    const order = prefs.order.slice();
    const i = order.indexOf(k), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    savePrefs({ ...prefs, order });
  }
  function sortBy(k) {
    setSort((s) => (s.k === k ? { k, dir: -s.dir } : { k, dir: k === "ts" || k === "secs" ? -1 : 1 }));
  }

  const rows = useMemo(() => {
    const base = (data?.recent || []).map((r) => ({
      ts: r.ts || 0,
      callerId: r.callerId || "",
      callback: r.callback || "",
      _match: matchState(r.callerId, r.callback),
      _text: r.textConsent === true ? "yes" : r.textConsent === false ? "no" : "",
      name: r.name || "",
      email: r.email || "",
      secs: r.secs || 0,
      outcome: r.outcome || "",
    }));
    const ql = q.trim().toLowerCase();
    const filtered = base.filter(
      (r) => !ql || [fmtTime(r), r.callerId, r.callback, r.name, r.email, fmt(r.secs), r.outcome, r._match, r._text].join(" ").toLowerCase().includes(ql)
    );
    const { k, dir } = sort;
    filtered.sort((a, b) => {
      const x = a[k] ?? "", y = b[k] ?? "";
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      if (!x && y) return 1;
      if (x && !y) return -1;
      return String(x).localeCompare(String(y)) * dir;
    });
    return filtered;
  }, [data, q, sort]);

  if (state === "error")
    return (
      <div className="wrap">
        <div className="err">
          We couldn't load your live call data just now. Your AI agent is still answering
          calls — try refreshing in a minute.
        </div>
      </div>
    );
  if (state === "loading" || !data)
    return <div className="wrap"><div className="notice">Loading your dashboard…</div></div>;

  const inc = data.included || 500;
  const used = data.minutesUsed || 0;

  const cell = (r, k) => {
    if (k === "ts") return fmtTime(r) || "—";
    if (k === "secs") return fmt(r.secs);
    if (k === "_match")
      return r._match === "match" ? <span className="ic ok">✓</span>
        : r._match === "mismatch" ? <span className="ic warn">⚠</span>
        : <span className="ic mute">—</span>;
    if (k === "_text")
      return r._text === "yes" ? <span className="ic ok">✓</span>
        : r._text === "no" ? <span className="ic no">✗</span>
        : <span className="ic mute">—</span>;
    if (k === "outcome") return <span className={"tag " + tagClass(r.outcome)}>{r.outcome}</span>;
    return r[k] || "—";
  };

  return (
    <div className="wrap">
      <div className="plan">
        <span className="pill cyan">{data.plan}</span>
        <span className="pill">{data.businessName}</span>
        <span className="pill" style={{ color: "var(--green)" }}>● live data</span>
      </div>

      <div className="grid">
        <div className="kpi"><div className="lab">Calls answered</div><div className="val green">{data.calls}</div><div className="sub">24/7, every one picked up</div></div>
        <div className="kpi"><div className="lab">Leads captured</div><div className="val cyan">{data.leads}</div><div className="sub">name · number · need</div></div>
        <div className="kpi"><div className="lab">Appointments booked</div><div className="val">{data.appointments}</div><div className="sub">on the calendar</div></div>
        <div className="kpi"><div className="lab">Avg call length</div><div className="val">{fmt(data.avgSec)}</div><div className="sub">across answered calls</div></div>
      </div>

      <div className="usage">
        <h3>Minutes used</h3>
        <div className="bar"><i style={{ width: Math.min(100, (used / inc) * 100) + "%" }} /></div>
        <div className="uinfo">
          <span><b style={{ color: "#fff" }}>{used}</b> of {inc} included minutes used</span>
          <span>{inc - used >= 0 ? inc - used + " left" : used - inc + " over"} · resets monthly</span>
        </div>
      </div>

      <div className="sec">
        <div className="sechead">
          <h3>Calls</h3>
          <div className="tools">
            <input className="search" type="search" placeholder="Search calls…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="gearwrap">
              <button className="gear" title="Customize columns" onClick={() => setCfgOpen((o) => !o)}>⚙</button>
              {cfgOpen && (
                <div className="cfgpop">
                  <h4>Columns</h4>
                  {prefs.order.map((k, i) => (
                    <div className="cfgrow" key={k}>
                      <label>
                        <input type="checkbox" checked={!prefs.hidden.includes(k)} onChange={() => toggleCol(k)} />
                        {" " + colDef(k).label}
                      </label>
                      <div className="cfgbtns">
                        <button disabled={i === 0} onClick={() => moveCol(k, -1)}>▲</button>
                        <button disabled={i === prefs.order.length - 1} onClick={() => moveCol(k, 1)}>▼</button>
                      </div>
                    </div>
                  ))}
                  <button className="cfgreset" onClick={() => savePrefs({ order: COLKEYS.slice(), hidden: [] })}>
                    Reset to default
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="tablescroll">
          <table>
            <thead>
              <tr>
                {visible.map((k) => {
                  const c = colDef(k);
                  return (
                    <th key={k} className={c.ctr ? "ctr" : ""} onClick={() => sortBy(k)}>
                      {c.label}
                      <span className="arr">{sort.k === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  {visible.map((k) => (
                    <td key={k} className={colDef(k).ctr ? "ctr" : ""}>{cell(r, k)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="nores">No calls match your search.</div>}
        </div>
      </div>

      <div className="foot">Client Connected · customer portal</div>
    </div>
  );
}
