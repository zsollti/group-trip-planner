import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@gtp/api-client";

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

/** Keeps already-authenticated users out of the login/register screens. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") return <DeckSplash />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}
