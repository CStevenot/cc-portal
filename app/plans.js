// Which plans include call-recording playback.
// Kept in its own module (not a route file) because Next.js restricts what a
// route.js may export — only HTTP handlers and specific config keys.
//
// Burke's pilot is included so he gets the full experience during the trial.
// Anything not listed here (e.g. "Starter") sees the locked/upsell state.
export const PLANS_WITH_RECORDINGS = ["pro", "growth", "scale", "enterprise", "pilot"];

export function planAllowsRecordings(plan) {
  return PLANS_WITH_RECORDINGS.includes(String(plan || "").trim().toLowerCase());
}
