import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, useAuth, useJoinTrip } from "@gtp/api-client";

/**
 * Invite redemption landing (Phase 1.3). Handles both arrivals (decision 3):
 *  - **logged out** → bounce to `/login?next=/join/:token`; the token rides the
 *    URL through login/register and we return here authenticated;
 *  - **logged in** → POST the token once and open the trip.
 * Guests/Participants need no verified email; a Co-organizer grant is gated by
 * the API, surfaced here as an error.
 */
export function Join() {
  const { token } = useParams<{ token: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();
  const joinTrip = useJoinTrip();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || !token || started.current) return;
    started.current = true;
    joinTrip
      .mutateAsync(token)
      .then((result) => navigate(`/trips/${result.tripId}`, { replace: true }))
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Couldn't join this trip.",
        ),
      );
  }, [status, token, joinTrip, navigate]);

  if (status === "loading") {
    return (
      <main className="deck deck--splash">
        <p className="deck__eyebrow">Command Deck</p>
        <p className="deck__lede">Initializing session…</p>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <Navigate to={`/login?next=/join/${encodeURIComponent(token ?? "")}`} replace />
    );
  }

  return (
    <main className="deck deck--auth">
      <div className="deck__auth-card">
        <p className="deck__eyebrow">Command Deck</p>
        {error ? (
          <>
            <h1 className="deck__title">Couldn't join</h1>
            <p className="deck__lede">{error}</p>
            <p className="deck__auth-alt">
              <Link to="/">Back to deck</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="deck__title">Joining trip…</h1>
            <p className="deck__lede">Redeeming your invite.</p>
          </>
        )}
      </div>
    </main>
  );
}
