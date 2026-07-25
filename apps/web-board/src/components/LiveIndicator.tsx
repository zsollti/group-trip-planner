import { useTripSocket } from "@gtp/api-client";

const LABEL = {
  connecting: "Connecting…",
  connected: "Live",
  error: "Offline",
  idle: "",
} as const;

/**
 * The trip's real-time connection indicator (Phase 4.1). Owning the
 * `useTripSocket` subscription here scopes the socket's lifetime to the trip
 * screen: it connects on mount and disconnects on unmount. For now it only
 * surfaces the connection state; the chat panel that rides this socket lands in
 * Phase 4.2.
 */
export function LiveIndicator({ tripId }: { tripId: string }) {
  const { status } = useTripSocket(tripId);
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
