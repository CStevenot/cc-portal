"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

const labelOf = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString([], { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" }) : "";
const pick = (lead, keys) => keys.map((k) => lead[k]).find(Boolean) || "";
const nameOf = (l) => pick(l, ["name", "caller_name", "customer_name", "full_name", "first_name", "business_name"]);
const contactOf = (l) => pick(l, ["email", "customer_email", "contact_email", "phone", "phone_number", "callback_number", "best_callback_number"]);
const sentClass = (s) => (s === "Positive" ? "booked" : s === "Negative" ? "missed" : "lead");

export default function ChatsPanel() {
  const [chats, setChats] = useState(null);
  const [state, setState] = useState("loading");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState({});

  useEffect(() => {
    let alive = true;
    fetch("/api/chats")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!alive) return; setChats(d.chats || []); setState("ok"); })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  function toggle(id) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!detail[id]) {
      setDetail((d) => ({ ...d, [id]: { loading: true } }));
      fetch(`/api/chats/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((c) => setDetail((d) => ({ ...d, [id]: c })))
        .catch(() => setDetail((d) => ({ ...d, [id]: { error: true } })));
    }
  }

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (chats || []).filter(
      (c) => !ql || [fmtTime(c.ts), c.summary, c.sentiment, ...Object.values(c.lead || {})].join(" ").toLowerCase().includes(ql)
    );
  }, [chats, q]);

  if (state === "error") return <div className="err">We couldn't load your chats just now. Try refreshing in a minute.</div>;
  if (state === "loading") return <div className="notice">Loading chats…</div>;
  if (!chats.length)
    return (
      <div className="notice">
        <h2>No website chats yet</h2>
        <p>When visitors use the chat on your website, each conversation shows up here with a summary and the full transcript.</p>
      </div>
    );

  return (
    <div className="sec">
      <div className="sechead">
        <h3>Website chats</h3>
        <div className="tools">
          <input className="search" type="search" placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tablescroll">
        <table>
          <thead>
            <tr>
              <th>Date &amp; Time</th><th>Visitor</th><th>Contact</th><th>Summary</th><th>Sentiment</th><th className="ctr">Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const d = detail[c.chatId];
              const isOpen = open === c.chatId;
              return (
                <Fragment key={c.chatId}>
                  <tr className="chatrow" onClick={() => toggle(c.chatId)}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtTime(c.ts)}</td>
                    <td>{nameOf(c.lead) || "—"}</td>
                    <td>{contactOf(c.lead) || "—"}</td>
                    <td className="chatsum">{c.summary || (c.status === "ongoing" ? "In progress" : "—")}</td>
                    <td>{c.sentiment ? <span className={"tag " + sentClass(c.sentiment)}>{c.sentiment}</span> : "—"}</td>
                    <td className="ctr">{c.status === "ongoing" ? <span className="ic mute">●</span> : <span className="ic ok">✓</span>}</td>
                    <td className="ctr"><button className={"playbtn" + (isOpen ? " on" : "")} aria-label={isOpen ? "Hide transcript" : "Show transcript"}>{isOpen ? "✕" : "▸"}</button></td>
                  </tr>
                  {isOpen && (
                    <tr className="playrow">
                      <td colSpan={7}>
                        <div className="chatdetail">
                          {Object.keys(c.lead || {}).length > 0 && (
                            <div className="leadgrid">
                              {Object.entries(c.lead).map(([k, v]) => (
                                <div key={k}><span className="lab">{labelOf(k)}</span><span>{v}</span></div>
                              ))}
                            </div>
                          )}
                          {!d || d.loading ? (
                            <div className="hint">Loading transcript…</div>
                          ) : d.error ? (
                            <div className="hint">Couldn't load this transcript.</div>
                          ) : (
                            <div className="transcript">
                              {(d.messages || []).map((m, i) => (
                                <div key={i} className={"msg " + m.role}>
                                  <span className="who">{m.role === "user" ? "Visitor" : "Agent"}</span>
                                  <span>{m.text}</span>
                                </div>
                              ))}
                              {!(d.messages || []).length && <div className="hint">No messages in this chat.</div>}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="nores">No chats match your search.</div>}
      </div>
    </div>
  );
}
