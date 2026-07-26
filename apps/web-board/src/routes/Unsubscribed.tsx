import { Link, useSearchParams } from "react-router-dom";

/**
 * The unsubscribe landing (Phase 5.3). The API applies the change and redirects
 * here, so this page only *reports* — it never needs the token, which is why the
 * address bar is clean by the time anyone reads it.
 *
 * Deliberately reachable **logged out**: the person clicking is in their mail
 * client, and making them sign in to confirm that they stopped mail would defeat
 * the point. The link back into the app is an invitation, not a requirement.
 */
export function Unsubscribed() {
  const [params] = useSearchParams();
  const invalid = params.get("status") === "invalid";

  return (
    <main className="board board--center">
      <section className="board__auth" aria-labelledby="unsub-heading">
        <p className="board__eyebrow">Group Trip Planner</p>
        {invalid ? (
          <>
            <h1 className="board__title" id="unsub-heading">
              That link didn't work
            </h1>
            <p className="board__muted">
              It may have been mistyped or truncated by your mail app. Nothing
              changed — you can turn mention emails off from notification
              settings instead.
            </p>
          </>
        ) : (
          <>
            <h1 className="board__title" id="unsub-heading">
              You're unsubscribed
            </h1>
            <p className="board__muted">
              We won't email you when someone @mentions you. You'll still see
              mentions in the app, and account emails — verifying your address,
              signing in — are unaffected.
            </p>
            <p className="board__muted">
              Changed your mind? Turn it back on in notification settings.
            </p>
          </>
        )}
        <Link className="board__cta" to="/settings">
          Notification settings
        </Link>
      </section>
    </main>
  );
}
