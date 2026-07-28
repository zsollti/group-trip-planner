import type { ReactNode } from "react";
import * as Sentry from "@sentry/react";

/**
 * Last-resort boundary around the whole app (Phase 7.5).
 *
 * A render-time throw in React 19 unmounts the tree, so without this the page
 * goes blank with nothing in it — the single worst thing a reviewer can be
 * shown, and the one failure the four-states pass in Phase 6.3 could not cover
 * (a query error state is a component *rendering*; this is a component
 * failing to render at all).
 *
 * It doubles as the reporting hook: `Sentry.ErrorBoundary` captures the
 * exception with the React component stack attached. When no DSN is configured
 * the SDK is uninitialised and capture is a no-op, so this stays a plain
 * boundary in local development rather than a Sentry dependency.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary fallback={<BoardCrash />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}

/**
 * Reload rather than "try again": the boundary has no idea what state the
 * store was in when the throw happened, and offering a retry that lands on the
 * same broken render is the empty-state mistake Phase 6.4 ruled out — never
 * offer an action that cannot work.
 */
function BoardCrash() {
  return (
    <div className="board board--center">
      <div className="board__auth" role="alert">
        <p className="board__eyebrow">Trip Board</p>
        <h1 className="board__title">Something broke on this page</h1>
        <p className="board__muted">
          The error has been recorded. Reloading usually clears it — your trips
          and decisions are stored on the server, so nothing was lost.
        </p>
        <button
          type="button"
          className="board__cta"
          onClick={() => window.location.reload()}
        >
          Reload the board
        </button>
      </div>
    </div>
  );
}
