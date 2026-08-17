import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { OAUTH_RETURN_MARKER, useAuth } from "@gtp/api-client";
import { safeNextPath } from "../lib/next";
import { t } from "../lib/i18n";

/** Canvas-style splash while the silent refresh resolves on load. */
function BoardSplash() {
  return (
    <div className="board board--center">
      <p className="board__eyebrow">{t("Trip Board")}</p>
      <p className="board__muted">{t("Loading your boards…")}</p>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();

  if (status === "loading") return <BoardSplash />;
  if (status === "unauthenticated") {
    // Carry the OAuth return marker across the bounce — and only that, so a
    // protected route's own query can't rewrite the sign-in card's `next`.
    // Landing here right after a provider round-trip means the silent refresh
    // failed, and the card can say so instead of looking like a fresh visit.
    const provider = params.get(OAUTH_RETURN_MARKER);
    const to = provider
      ? `/login?${OAUTH_RETURN_MARKER}=${encodeURIComponent(provider)}`
      : "/login";
    return <Navigate to={to} replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Honors a `?next=` target so it agrees with Login's post-auth redirect
 * (e.g. an invite arrived on logged out) instead of racing it back to "/". */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === "loading") return <BoardSplash />;
  if (status === "authenticated") {
    return <Navigate to={safeNextPath(params.get("next")) ?? "/"} replace />;
  }
  return <>{children}</>;
}
