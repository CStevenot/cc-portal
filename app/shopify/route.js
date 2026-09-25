// Embedded Shopify admin page. A route handler (not a page) so it skips the
// portal's Clerk layout: inside Shopify admin the merchant is authenticated by
// App Bridge session tokens, not a Clerk cookie. App Bridge must be the first
// script on the page.

export const dynamic = "force-dynamic";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function GET(req) {
  const shop = new URL(req.url).searchParams.get("shop") || "";
  const apiKey = process.env.SHOPIFY_CLIENT_ID || "";
  const frame = SHOP_RE.test(shop)
    ? `frame-ancestors https://${shop} https://admin.shopify.com;`
    : "frame-ancestors https://admin.shopify.com;";

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="${esc(apiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<title>Client Connected</title>
<style>
body{margin:0;background:#f1f1f1;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#303030}
main{max-width:760px;margin:0 auto;padding:24px}
h1{font-size:20px;font-weight:650;margin:0 0 16px}
h2{font-size:16px;margin:0 0 8px}h3{font-size:14px;margin:0 0 8px}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 0 rgba(0,0,0,.07);margin-bottom:16px}
.err{border-left:4px solid #c5280c}
p{margin:0}.muted{color:#616161}
button{background:#303030;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;margin-top:12px}
button:disabled{opacity:.6;cursor:default}
.foot{font-size:12px;color:#8a8a8a}
</style></head>
<body><main>
<h1>Client Connected</h1>
<div id="app"><div class="card">Loading…</div></div>
<p class="foot">Calls are recorded and kept 90 days. We read order status and match the caller's email or phone to the order; we never store your order data.
<a href="https://www.client-connected.com/privacy" target="_blank" rel="noreferrer">Privacy policy</a></p>
</main>
<script>
(function(){
  var app = document.getElementById("app");
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  async function api(path){
    var t = await window.shopify.idToken();
    var r = await fetch(path,{method:"POST",headers:{Authorization:"Bearer "+t}});
    if(!r.ok) throw new Error(path+" "+r.status);
    return r.json();
  }
  function fail(msg){ app.innerHTML = '<div class="card err">'+esc(msg)+'</div>'; }
  function render(s){
    var agents = s.agentsLinked > 0
      ? s.agentsLinked + " agent" + (s.agentsLinked===1?"":"s") + " connected to your store. Order lookups are live."
      : "Your agents are being set up by our team. We'll email you when your line is live. Questions: support@client-connected.com";
    var sub = s.subscription && s.subscription.status === "ACTIVE"
      ? "<p>Active"+(s.subscription.test?" (test)":"")+". Billed through Shopify.</p>"
      : "<p>Billed through Shopify: a monthly plan plus per-minute overage, capped at an amount you approve.</p><button id=\\"sub\\">Start subscription</button>";
    app.innerHTML =
      '<div class="card"><h2>'+esc(s.businessName)+'</h2><p class="muted">AI phone agents that answer your customers 24/7: order status, returns, warranty claims, and sales.</p></div>'+
      '<div class="card"><h3>Phone agents</h3><p>'+esc(agents)+'</p></div>'+
      '<div class="card"><h3>Subscription</h3>'+sub+'</div>';
    var b = document.getElementById("sub");
    if(b) b.onclick = async function(){
      b.disabled = true; b.textContent = "Opening…";
      try { var r = await api("/api/shopify/billing"); window.open(r.confirmationUrl, "_top"); }
      catch(e){ fail("Couldn't start the subscription. Try again, or contact support@client-connected.com."); }
    };
  }
  api("/api/shopify/session").then(render).catch(function(){
    fail("We couldn't load your account. Refresh, or contact support@client-connected.com.");
  });
})();
</script>
</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": frame,
      "Cache-Control": "no-store",
    },
  });
}
