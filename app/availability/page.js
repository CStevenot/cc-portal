import { auth } from "@clerk/nextjs/server";
import AvailabilityEditor from "../AvailabilityEditor";

export default async function AvailabilityPage() {
  const { orgId } = await auth();
  if (!orgId) {
    return (
      <div className="wrap">
        <div className="notice">
          <h2>Almost there</h2>
          <p>
            Your login isn&apos;t linked to a business account yet. Pick your business from the switcher at the top
            right, or contact your Client Connected rep to get set up.
          </p>
        </div>
      </div>
    );
  }
  return <AvailabilityEditor />;
}
