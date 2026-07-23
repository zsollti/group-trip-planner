import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@gtp/api-client";
import { safeNextPath } from "../lib/next";

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

/** Honors a `?next=` target so it agrees with Login's post-auth redirect
 * (e.g. an invite arrived on logged out) instead of racing it back to "/". */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === "loading") return <FeedSplash />;
  if (status === "authenticated") {
    return <Navigate to={safeNextPath(params.get("next")) ?? "/"} replace />;
  }
  return <>{children}</>;
}
