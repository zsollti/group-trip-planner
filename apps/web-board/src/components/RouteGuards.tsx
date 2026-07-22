import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@gtp/api-client";

/** Canvas-style splash while the silent refresh resolves on load. */
function BoardSplash() {
  return (
    <div className="board board--center">
      <p className="board__eyebrow">Trip Board</p>
      <p className="board__muted">Loading your boards…</p>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <BoardSplash />;
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") return <BoardSplash />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}
