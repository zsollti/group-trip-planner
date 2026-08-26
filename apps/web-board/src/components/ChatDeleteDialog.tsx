import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { useDeleteChannels } from "@gtp/api-client";
import type { ChannelView } from "@gtp/types";
import { Dialog } from "./Dialog";
import { plural, t } from "../lib/i18n";

/**
 * Closing discussions on a board (post-launch, organizers).
 *
 * **The board's own conversation is not on the list.** It is created inside the
 * trip-creation transaction and nothing recreates it, so deleting it would take
 * a board's only permanent conversation away with no way back — the owner's
 * call, and the server refuses it too, so this list is a courtesy rather than
 * the enforcement. Lane discussions are different in exactly the way that
 * matters: "Discuss" on a lane starts one again whenever anybody wants it.
 *
 * **Tick, then delete, then confirm.** The ticking is the choosing and the
 * confirm is the last word, which is why they are two steps and not a row of
 * per-channel delete buttons: this act takes everything everyone said in those
 * conversations, and a control that does it on one click is a control that does
 * it by accident.
 *
 * The confirm names the number, because by the time it appears the ticks are
 * behind it and "delete these?" is a question about something the reader can no
 * longer see.
 */
export function ChatDeleteDialog({
  tripId,
  channels,
  channelName,
  onClose,
}: {
  tripId: string;
  /** The lane discussions. The trip-wide channel is filtered out by the caller,
   *  which is also the only component that knows which one that is. */
  channels: ChannelView[];
  channelName: (channel: ChannelView) => string;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useDeleteChannels(tripId);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    setError(null);
    remove.mutate(
      { channelIds: [...picked] },
      {
        // The socket's `channels:deleted` does the forgetting, for every reader
        // on the board rather than only this one. Nothing to reconcile here.
        onSuccess: () => onClose(),
        onError: (e) => {
          setConfirming(false);
          setError(e.message);
        },
      },
    );
  }

  return (
    <Dialog title={t("Delete discussions")} onClose={onClose}>
      {channels.length === 0 ? (
        <p className="board__muted">
          {t("This board has no discussions to delete yet.")}
        </p>
      ) : (
        <>
          <p className="board__panel-note">
            {t(
              "Everything said in a discussion goes with it. A lane can always be discussed again.",
            )}
          </p>
          <ul className="board__checklist">
            {channels.map((c) => (
              <li key={c.id}>
                <label className="board__checkline">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    disabled={confirming || remove.isPending}
                    onChange={() => toggle(c.id)}
                  />
                  <span>{channelName(c)}</span>
                </label>
              </li>
            ))}
          </ul>

          {error ? (
            <p className="board__form-error" role="alert">
              {error}
            </p>
          ) : null}

          {confirming ? (
            <div className="board__dialog-actions board__dialog-actions--stack">
              <p className="board__muted">
                {plural(
                  picked.size,
                  "Delete {n} discussion and everything said in it? This cannot be undone.",
                  "Delete {n} discussions and everything said in them? This cannot be undone.",
                )}
              </p>
              <div className="board__dialog-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                >
                  {t("Cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={remove.isPending}
                  onClick={confirm}
                >
                  {remove.isPending ? t("Deleting…") : t("Delete")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="board__dialog-actions">
              <Button
                type="button"
                variant="primary"
                disabled={picked.size === 0}
                onClick={() => setConfirming(true)}
              >
                {t("Delete")}
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
