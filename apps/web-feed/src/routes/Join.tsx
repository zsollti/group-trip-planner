import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, useAuth, useJoinTrip } from "@gtp/api-client";

/**
 * Invite redemption landing (Phase 1.3). Logged-out arrivals bounce to
 * `/login?next=/join/:token` (the token rides the URL through auth); logged-in
 * arrivals redeem the token once and open the trip.
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
      <div className="feed">
        <main className="feed__screen feed__center">
          <p className="feed__muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <Navigate to={`/login?next=/join/${encodeURIComponent(token ?? "")}`} replace />
    );
  }

  return (
    <div className="feed">
      <main className="feed__screen feed__center">
        <div className="feed__card">
        {error ? (
          <>
            <div className="feed__card-media">🚫</div>
            <p className="feed__card-body">{error}</p>
            <div className="feed__card-cta">
              <Link className="feed__alt" to="/">
                Back to home
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="feed__card-media">🎟️</div>
            <p className="feed__card-body">Joining trip…</p>
          </>
        )}
        </div>
      </main>
    </div>
  );
}
