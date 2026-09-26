// Public privacy policy (linked from the Shopify app and the App Store listing).
// Keep in plain language. Changes here should go through legal review.

export const metadata = {
  title: "Privacy Policy — Client Connected",
  description: "How Client Connected handles call and customer data.",
};

const S = { maxWidth: 760, lineHeight: 1.6 };
const H = { fontSize: 18, margin: "28px 0 8px" };

export default function Privacy() {
  return (
    <div className="wrap" style={S}>
      <h1 style={{ fontSize: 26, margin: "8px 0 4px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--mute)", margin: 0 }}>Client Connected LLC · Last updated September 24, 2026</p>

      <p>
        Client Connected provides AI phone agents that answer calls for businesses (&quot;our clients&quot;),
        including merchants who install our Shopify app. This policy explains what we collect when
        someone calls one of those businesses, and when a business uses our portal or Shopify app.
      </p>

      <h2 style={H}>What we collect</h2>
      <ul>
        <li><b>Call data:</b> the audio recording, a transcript, the calling number, call time and length, and
          details the caller gives, such as name, phone, email, order number, and the reason for calling.</li>
        <li><b>Shopify order status, read live:</b> if a caller asks about an order, we look it up in the
          merchant&apos;s Shopify store only after the caller gives the order number and the email or phone on
          that order. We read status, items, and tracking to answer the call. We do not store Shopify order or
          customer records.</li>
        <li><b>Client account data:</b> names and emails of the business&apos;s users of our portal, and the
          business&apos;s settings. For Shopify merchants, the store domain and an access token, which is stored
          encrypted.</li>
      </ul>

      <h2 style={H}>How we use it</h2>
      <p>
        Only to answer and route calls, give the business a record of its calls and requests, bill for the
        service, keep the service secure, and fix problems. We do not sell personal information, share it for
        advertising, or use it to train AI models.
      </p>

      <h2 style={H}>Who processes it for us</h2>
      <p>
        We use service providers that handle data on our behalf under contract. These cover voice and call
        processing (Retell AI and the AI language models it runs), portal sign-in (Clerk), and hosting (Vercel).
        If a merchant uses our Shopify app, Shopify processes its billing. The business you called also sees
        its own calls.
      </p>

      <h2 style={H}>Recording</h2>
      <p>
        Calls are recorded, and callers are told at the start of the call. Businesses that use our service are
        responsible for any additional notices their location requires.
      </p>

      <h2 style={H}>How long we keep it</h2>
      <p>
        For merchants using our Shopify app, recordings and transcripts are deleted after 90 days. For other
        clients, they are kept for the period set in that client&apos;s agreement and then deleted. When a
        merchant uninstalls the Shopify app, we delete its access token right away. We act on Shopify&apos;s
        data deletion requests, including deleting a customer&apos;s calls when the merchant requests it.
      </p>

      <h2 style={H}>Your choices</h2>
      <p>
        You can ask for a copy of, or deletion of, calls you made. Contact the business you called or email us
        at the address below. We will verify the request and respond within 30 days. Where the business is the
        controller of the data, we work through them.
      </p>

      <h2 style={H}>Security</h2>
      <p>
        Data is encrypted in transit. Store access tokens are encrypted at rest. Access is limited to the
        business the data belongs to and to Client Connected staff who need it to run the service. Our logs
        leave out email addresses and phone numbers.
      </p>

      <h2 style={H}>Children</h2>
      <p>Our service is for businesses and is not directed to children under 13.</p>

      <h2 style={H}>Changes</h2>
      <p>If we make material changes, we will update this page and the date above.</p>

      <h2 style={H}>Contact</h2>
      <p>
        Client Connected LLC, Columbus, Ohio ·{" "}
        <a href="mailto:support@client-connected.com" style={{ color: "var(--cyan)" }}>support@client-connected.com</a>
      </p>
    </div>
  );
}
