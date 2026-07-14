import { auth } from "@clerk/nextjs/server";
import Dashboard from "./Dashboard";

export default async function Home() {
  const { orgId } = await auth();
  if (!orgId) {
    return (
      <div className="wrap">
        <div className="notice">
          <h2>Almost there</h2>
          <p>
            Your login isn't linked to a business account yet. If you just accepted an
            invitation, pick your business from the switcher at the top right. Otherwise,
            contact your Client Connected rep to get set up.
          </p>
        </div>
      </div>
    );
  }
  return <Dashboard />;
}
