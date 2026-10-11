import Link from "next/link";
import { signIn } from "@/auth";

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="signin-shell">
      <Link className="brand-lockup signin-brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          F
        </span>
        <span>frontdesk</span>
      </Link>
      <section className="signin-card">
        <div className="signin-icon">✳</div>
        <div className="eyebrow">WELCOME TO YOUR FRONT DESK</div>
        <h1>Good support starts here.</h1>
        <p>Sign in to set up your workspace and build a front desk that knows your business.</p>
        {googleConfigured ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <button className="button button-primary button-full" type="submit">
              <span className="google-g">G</span> Continue with Google
            </button>
          </form>
        ) : (
          <div className="config-note">
            <b>Google sign-in needs setup</b>
            <span>
              Add the OAuth values from <code>.env.example</code> to your local <code>.env</code>,
              then restart the app.
            </span>
          </div>
        )}
        <div className="signin-divider">
          <span /> <small>SECURE SIGN IN</small> <span />
        </div>
        <p className="signin-footnote">
          Your account keeps your workspace and its business data private.
        </p>
      </section>
      <Link className="back-home" href="/">
        ← Back to home
      </Link>
    </main>
  );
}
