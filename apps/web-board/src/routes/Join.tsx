import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, useAuth, useJoinTrip } from "@gtp/api-client";

/**
 * Invite redemption landing (Phase 1.3). Logged-out arrivals bounce to
 * `/login?next=/join/:token` (the token rides the URL through auth); logged-in
 * arrivals redeem the token once and open the board.
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
          err instanceof ApiError ? err.message : "Couldn't join this board.",
        ),
      );
  }, [status, token, joinTrip, navigate]);

  if (status === "loading") {
    return (
      <main className="board board--center">
        <p className="board__muted">Loading…</p>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <Navigate
        to={`/login?next=/join/${encodeURIComponent(token ?? "")}`}
        replace
      />
    );
  }

  return (
    <main className="board board--center">
      <div className="board__auth">
        <p className="board__eyebrow">Trip Board</p>
        {error ? (
          <>
            <h1 className="board__title">Couldn't join</h1>
            <p className="board__muted">{error}</p>
            <p className="board__alt">
              <Link to="/">Back to boards</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="board__title">Joining board…</h1>
            <p className="board__muted">Redeeming your invite.</p>
          </>
        )}
      </div>
    </main>
  );
}
