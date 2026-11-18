/**
 * Public landing page (the only page outside Cloudflare Access). It loads no data
 * and calls no API — "Sign in" goes to /app, where Cloudflare Access asks for the
 * email one-time code and then returns the user to the app.
 */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <img src="/logo.svg" alt="" className="mx-auto h-16 w-16 drop-shadow-sm" />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">VAT</h1>
          <p className="muted mx-auto mt-3 max-w-sm text-sm leading-relaxed">
            Turn the monthly sales export into an e-Faktur CSV that's ready to upload — the same result as the desktop app, now in your browser.
          </p>

          <a href="/app" className="btn-primary mt-8 w-full py-3 text-base">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
            Sign in with Cloudflare
          </a>
          <p className="muted mt-3 text-xs">You'll get a one-time code by email. Only approved addresses can sign in.</p>
        </div>
      </main>
      <footer className="muted pb-6 text-center text-xs">Protected by Cloudflare Access</footer>
    </div>
  );
}
