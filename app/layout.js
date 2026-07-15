import {
  ClerkProvider,
  SignedIn,
  UserButton,
  OrganizationSwitcher,
} from "@clerk/nextjs";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Client Connected — Customer Portal",
  description: "Your AI phone agent — calls answered, leads captured, minutes used.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <SignedIn>
            <header className="top">
              <Link href="/" className="brand">
                Client <span>Connected</span>
              </Link>
              <div className="topright">
                <OrganizationSwitcher
                  hidePersonal
                  afterSelectOrganizationUrl="/"
                  appearance={{ elements: { rootBox: "orgswitcher" } }}
                />
                <Link href="/availability" className="navlink">
                  Availability
                </Link>
                <Link href="/account" className="navlink">
                  Account Settings
                </Link>
                <UserButton />
              </div>
            </header>
          </SignedIn>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
