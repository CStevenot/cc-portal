import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="authwrap">
      <div className="authbrand">
        Client <span>Connected</span>
      </div>
      <p className="authsub">Customer Portal</p>
      <SignIn />
    </div>
  );
}
