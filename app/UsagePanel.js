"use client";

import { useEffect, useState } from "react";

// "This month" usage and charges, per medium. Data: GET /api/usage.
const LABEL = { calls: "Calls", chats: "Website chats", texts: "Texts" };
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString("en-US");
const unitOf = (r, n) => (r.unit === "min" ? `${num(n)} min` : num(n));

function monthLabel(start) {
  const d = new Date(start);
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function UsagePanel() {
  const [u, setU] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!alive) return; if (d.error) throw 0; setU(d); setState("ok"); })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  if (state === "loading") return <div className="usage"><h3>This month</h3><div className="uinfo"><span>Loading usage…</span></div></div>;
  if (state === "error") return <div className="usage"><h3>This month</h3><div className="uinfo"><span>Usage is unavailable right now. Try refreshing in a minute.</span></div></div>;

  return (
    <div className="usage">
      <div className="usagehead">
        <h3>This month · {monthLabel(u.start)}</h3>
        <span className="mute">{u.plan} · updated {new Date(u.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      </div>

      <div className="urows">
        {u.rows.map((r) => {
          const billed = r.included !== null && r.included !== undefined;
          const pct = billed && r.included > 0 ? Math.min(100, ((r.used || 0) / r.included) * 100) : 0;
          return (
            <div className="urow" key={r.medium}>
              <div className="umed">{LABEL[r.medium] || r.medium}</div>
              <div className="ubody">
                {billed ? (
                  <>
                    <div className="bar"><i style={{ width: pct + "%" }} className={r.over > 0 ? "over" : ""} /></div>
                    <div className="uinfo">
                      <span><b>{unitOf(r, r.used)}</b> of {unitOf(r, r.included)} included</span>
                      <span>
                        {r.over > 0
                          ? `${unitOf(r, r.over)} over × ${money(r.rate)} = ${money(r.charge)}`
                          : `${unitOf(r, r.included - (r.used || 0))} left`}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="uinfo">
                    <span><b>{r.used === null || r.used === undefined ? "—" : num(r.used)}</b> {r.medium === "texts" ? "checkout links texted on calls" : "this month"}</span>
                    <span>{r.medium === "texts" && (r.used === null || r.used === undefined) ? "connect your store to count texts" : "included, no charge"}</span>
                  </div>
                )}
              </div>
              <div className="ucharge">{money(r.charge)}</div>
            </div>
          );
        })}
      </div>

      <div className="utotal">
        {u.base !== null && u.base !== undefined && (
          <div><span>Plan</span><span>{money(u.base)}</span></div>
        )}
        <div>
          <span>Usage so far{u.capped ? ` (capped at ${money(u.usageCap)})` : ""}</span>
          <span>{money(u.usageBilled)}</span>
        </div>
        <div className="grand"><span>Estimated this month</span><span>{money(u.total)}</span></div>
        <p className="mute small">
          {u.shopify
            ? `Billed through Shopify. The plan renews every 30 days; usage over your allowance bills on the 1st for the month before${u.usageCap ? `, never more than ${money(u.usageCap)} per billing cycle` : ""}. A chat counts once the visitor sends a message.`
            : "Minutes over your plan are charged at the overage rate shown. Chats and texts are included."}
        </p>
      </div>
    </div>
  );
}
