// Slot engine — turns a saved availability config into concrete open appointment
// times. Pure functions, no I/O, so the agent endpoint and the editor preview can
// share one source of truth about what "open" means.
//
// All arithmetic is done in the CUSTOMER'S timezone, not the server's. Vercel runs
// in UTC, so doing this naively would offer Burke's customers 8am UTC = 3am Ohio.
// We use Intl to get the real offset for each instant, which also handles DST —
// important because a fixed offset would silently shift every appointment by an
// hour twice a year.

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Intl weekday -> our config keys
const WD = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

// How far ahead of UTC the given timezone is, at that specific instant.
function tzOffsetMs(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(ts))) map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - ts;
}

// Wall-clock time in `timeZone` -> UTC timestamp.
// Applied twice: the first pass can land on the wrong side of a DST boundary,
// and re-deriving the offset from the corrected instant fixes it.
export function zonedToUtc(y, mo, d, h, mi, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ts = guess - tzOffsetMs(guess, timeZone);
  ts = guess - tzOffsetMs(ts, timeZone);
  return ts;
}

// UTC timestamp -> calendar fields as seen in `timeZone`.
export function zonedParts(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(ts))) map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    h: hour,
    mi: Number(map.minute),
    dayKey: WD[map.weekday] || "mon",
    date: `${map.year}-${map.month}-${map.day}`,
  };
}

// "Thursday, July 23 at 9:00 AM" — written to be spoken aloud by the agent.
export function speakSlot(ts, timeZone) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(ts));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ts));
  return `${day} at ${time}`;
}

/**
 * Compute open appointment slots.
 *
 * NOTE ON maxPerDay: with no bookings datastore yet, we cannot know what is
 * already on the calendar. maxPerDay therefore caps how many slots we OFFER per
 * day, it does not subtract existing appointments. Real conflict-checking
 * arrives with the Google Calendar free/busy integration.
 *
 * @param {object} cfg        sanitized availability config
 * @param {object} [opts]
 * @param {number} [opts.now]         current time in ms (injectable for tests)
 * @param {number} [opts.horizonDays] how far ahead to look
 * @param {number} [opts.limit]       max slots to return
 * @param {string} [opts.onDate]      restrict to one YYYY-MM-DD
 * @param {string} [opts.onDay]       restrict to one weekday key (mon..sun)
 * @param {boolean} [opts.spread]     prefer slots on distinct days
 */
export function computeSlots(cfg, opts = {}) {
  const {
    now = Date.now(),
    horizonDays = 14,
    limit = 3,
    onDate = null,
    onDay = null,
    spread = true,
  } = opts;

  const tz = cfg.timezone || "America/New_York";
  const step = Math.max(15, Number(cfg.slotMinutes) || 60) + Math.max(0, Number(cfg.bufferMinutes) || 0);
  const dur = Math.max(15, Number(cfg.slotMinutes) || 60);
  const maxPerDay = Math.max(1, Number(cfg.maxPerDay) || 6);
  const earliest = now + Math.max(0, Number(cfg.leadHours) || 0) * 3600_000;
  const blackouts = new Set(Array.isArray(cfg.blackouts) ? cfg.blackouts : []);

  const today = zonedParts(now, tz);
  const byDay = [];

  for (let i = 0; i < horizonDays; i++) {
    // Step a day at a time from today's local midnight. Re-deriving parts each
    // iteration (rather than adding 86400000) keeps DST days correct.
    const probe = zonedToUtc(today.y, today.mo, today.d, 12, 0, tz) + i * 86400_000;
    const p = zonedParts(probe, tz);

    if (blackouts.has(p.date)) continue;
    if (onDate && p.date !== onDate) continue;
    if (onDay && p.dayKey !== onDay) continue;

    const day = (cfg.days && cfg.days[p.dayKey]) || null;
    if (!day || !day.open) continue;

    const openMin = toMin(day.start);
    const closeMin = toMin(day.end);
    const slots = [];

    for (let m = openMin; m + dur <= closeMin && slots.length < maxPerDay; m += step) {
      const ts = zonedToUtc(p.y, p.mo, p.d, Math.floor(m / 60), m % 60, tz);
      if (ts < earliest) continue;
      slots.push({
        start: new Date(ts).toISOString(),
        startMs: ts,
        end: new Date(ts + dur * 60_000).toISOString(),
        date: p.date,
        dayKey: p.dayKey,
        label: speakSlot(ts, tz),
      });
    }

    if (slots.length) byDay.push(slots);
  }

  // Offering three times on one morning is a worse experience than offering one
  // each on three different days — a caller who can't do Thursday is stuck.
  // Round-robin across days first, then backfill.
  const out = [];
  if (spread) {
    for (let round = 0; out.length < limit; round++) {
      let added = false;
      for (const day of byDay) {
        if (day[round]) {
          out.push(day[round]);
          added = true;
          if (out.length >= limit) break;
        }
      }
      if (!added) break;
    }
  } else {
    for (const day of byDay) {
      for (const s of day) {
        out.push(s);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
  }

  out.sort((a, b) => a.startMs - b.startMs);
  return out.map(({ startMs, ...rest }) => rest);
}

// Natural-language summary of the weekly hours, for when a caller asks
// "when are you open?" rather than asking for a specific appointment.
export function describeHours(cfg) {
  const names = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  const fmt = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${h12}:${pad(m)} ${ampm}` : `${h12} ${ampm}`;
  };

  // Collapse consecutive days that share the same window: "Monday to Friday, 8 AM to 5 PM"
  const runs = [];
  for (const k of DAY_KEYS) {
    const d = cfg.days && cfg.days[k];
    if (!d || !d.open) continue;
    const win = `${d.start}-${d.end}`;
    const last = runs[runs.length - 1];
    if (last && last.win === win && DAY_KEYS.indexOf(last.to) === DAY_KEYS.indexOf(k) - 1) {
      last.to = k;
    } else {
      runs.push({ from: k, to: k, win, start: d.start, end: d.end });
    }
  }
  if (!runs.length) return "no regular hours set";
  return runs
    .map((r) => {
      const span = r.from === r.to ? names[r.from] : `${names[r.from]} to ${names[r.to]}`;
      return `${span}, ${fmt(r.start)} to ${fmt(r.end)}`;
    })
    .join("; ");
}
