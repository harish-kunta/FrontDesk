import Link from "next/link";

export default function HomePage() {
  return (
    <main className="marketing-shell">
      <nav className="marketing-nav">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <span>frontdesk</span>
        </Link>
        <Link className="nav-signin" href="/signin">
          Sign in <span aria-hidden="true">↗</span>
        </Link>
      </nav>
      <section className="hero-wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> YOUR KNOWLEDGE, ALWAYS ON
          </div>
          <h1>
            Your best support person.
            <br />
            <em>Always at the desk.</em>
          </h1>
          <p className="hero-description">
            Give every visitor a helpful first answer, grounded in what your business actually
            knows.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/signin">
              Get started <span aria-hidden="true">→</span>
            </Link>
            <span className="quiet-note">A thoughtful little AI front desk.</span>
          </div>
        </div>
        <div className="hero-art" aria-label="A preview of the FrontDesk chat assistant">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-spark spark-one">✳</div>
          <div className="art-spark spark-two">✳</div>
          <div className="preview-window">
            <div className="preview-top">
              <span className="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="preview-label">YOUR FRONT DESK</span>
              <span className="preview-live">
                <i /> LIVE
              </span>
            </div>
            <div className="preview-body">
              <div className="assistant-avatar">F</div>
              <div className="preview-greeting">
                Hi there! <span>☀</span>
                <br />
                What can I help you find?
              </div>
              <div className="preview-question">Do you deliver to Canada?</div>
              <div className="preview-answer">
                We do! Standard shipping to Canada takes 5–8 business days.{" "}
                <span className="source-link">↗ Shipping &amp; returns</span>
              </div>
              <div className="preview-input">
                Ask us anything <span>↑</span>
              </div>
            </div>
          </div>
          <div className="floating-note">
            <span className="note-icon">✦</span>
            <span>
              <b>Answers with sources</b>
              <small>Helpful, and easy to verify.</small>
            </span>
          </div>
        </div>
      </section>
      <section className="promise-strip">
        <span>MADE FOR THE QUESTIONS THAT COME UP EVERY DAY</span>
        <div>
          <i>01</i> Your content, your answers
        </div>
        <div>
          <i>02</i> A human when it matters
        </div>
        <div>
          <i>03</i> Ready in a few minutes
        </div>
      </section>
      <footer className="marketing-footer">
        <span>© 2026 FrontDesk</span>
        <span>Support with a little more heart.</span>
      </footer>
    </main>
  );
}
