import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@gtp/api-client";

/** Friendly full-screen splash while the silent refresh resolves on load. */
function FeedSplash() {
  return (
    <div className="feed">
      <main className="feed__screen feed__center">
        <p className="feed__eyebrow">Trip Feed</p>
        <p className="feed__muted">Getting things ready…</p>
      </main>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FeedSplash />;
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") return <FeedSplash />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}
