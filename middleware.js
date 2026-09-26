import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything except the sign-in flow requires authentication.
// /api/agent/* is the exception: Retell calls it server-to-server with no session,
// so it authenticates itself (Retell signature + live call verification) instead.
// /shopify and /api/shopify/* run inside Shopify admin or are called by Shopify/Retell;
// each authenticates itself (session token, webhook HMAC, or Retell signature).
// /api/cron/* checks CRON_SECRET. /privacy is the public privacy policy.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/agent(.*)",
  "/shopify(.*)",
  "/api/shopify(.*)",
  "/api/cron(.*)",
  "/privacy",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ico|webp|woff2?|ttf|map)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
