import { OrganizationProfile } from "@clerk/nextjs";

// Admins manage members here: invite additional users, set roles (admin / member),
// and remove them. Members see a read-only view. This is the "Account Settings" area.
export default function AccountPage() {
  return (
    <div className="wrap accountwrap">
      <h2 className="pagetitle">Account Settings</h2>
      <p className="pagesub">Manage your business's portal users and access.</p>
      <OrganizationProfile routing="path" path="/account" />
    </div>
  );
}
