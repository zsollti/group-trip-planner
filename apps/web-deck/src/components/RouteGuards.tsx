import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@gtp/api-client";
import { safeNextPath } from "../lib/next";

/** Console-style splash shown while the silent refresh resolves on load. */
function DeckSplash() {
  return (
    <main className="deck deck--splash">
      <p className="deck__eyebrow">Command Deck</p>
      <p className="deck__lede">Initializing session…</p>
    </main>
  );
}

/** Client auth guard: gates the workspace behind an authenticated session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <DeckSplash />;
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Keeps already-authenticated users out of the login/register screens. Honors
 * a `?next=` target (e.g. an invite the user arrived on logged out) so it agrees
 * with Login's own post-auth redirect instead of racing it back to "/". */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === "loading") return <DeckSplash />;
  if (status === "authenticated") {
    return <Navigate to={safeNextPath(params.get("next")) ?? "/"} replace />;
  }
  return <>{children}</>;
}
