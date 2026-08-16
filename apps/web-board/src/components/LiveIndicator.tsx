import type { SocketStatus } from "@gtp/api-client";

/**
 * Says when the board has **stopped** updating itself — and nothing otherwise.
 *
 * This used to report all three states, so a working board carried a green dot
 * and the word "Live" permanently in its header. That is chrome describing the
 * normal case: the board updating as people vote is what the reader already
 * expects, and a badge confirming it earns none of the space it takes. Worse,
 * a signal that is green all day is one nobody reads on the day it isn't.
 *
 * What is worth interrupting for is the failure: when the socket drops, the
 * board keeps drawing the last thing it heard, and a stale screen is
 * indistinguishable from a quiet trip. So `error` says so, and `connecting`
 * stays silent because it is the ordinary first half-second of every page load.
 *
 * Presentational — the `useTripSocket` subscription is owned once by TripDetail
 * and shared with the chat panel, so there's a single socket per trip. The
 * state itself is published by that header as `data-socket-status`, for the
 * readers (tests, debugging) that need all three states rather than the one
 * worth a person's attention.
 */
export function LiveIndicator({ status }: { status: SocketStatus }) {
  if (status !== "error") return null;
  return (
    <span className="board__live board__live--error" role="status" aria-live="polite">
      <span className="board__live-dot" aria-hidden="true" />
      Offline — not updating
    </span>
  );
}
