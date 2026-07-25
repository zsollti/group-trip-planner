import type { SocketStatus } from "@gtp/api-client";

const LABEL: Record<SocketStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  error: "Offline",
  idle: "",
};

/**
 * The trip's real-time connection indicator (Phase 4.1). Presentational — the
 * `useTripSocket` subscription is owned once by TripDetail and shared with the
 * chat panel, so there's a single socket per trip. Just surfaces the state.
 */
export function LiveIndicator({ status }: { status: SocketStatus }) {
  if (status === "idle") return null;
  return (
    <span
      className={`board__live board__live--${status}`}
      role="status"
      aria-live="polite"
    >
      <span className="board__live-dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
