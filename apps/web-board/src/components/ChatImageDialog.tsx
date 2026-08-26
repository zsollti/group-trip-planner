import { useState } from "react";
import { useRemoveChatImage, useSetChatImage } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { ImagePicker } from "./ImagePicker";
import { t } from "../lib/i18n";

/**
 * The picture a board's chat wears, set from the conversation's own menu.
 *
 * **A dialog rather than a field in Edit trip.** The picture is only ever
 * looked at in the chat — on the folded bubble, in the panel header, on the row
 * in the conversation list — so the place to change it is the chat, where the
 * reader can see what they are changing. Putting it in the trip's edit form
 * would mean choosing a 28-pixel circle from a screen that never shows one.
 *
 * **Its own commit, not a staged pick.** `ImagePicker` has both shapes; the
 * staged one exists for a picker that is one field of a larger form, and this
 * dialog has no other fields. So the picker keeps its own Save, and pressing it
 * is the whole of the interaction.
 *
 * Cropped to a circle, because every surface that shows it draws a circle. A
 * cover is not cropped for the opposite reason: nothing draws it round.
 */
export function ChatImageDialog({
  tripId,
  tripName,
  currentUrl,
  onClose,
}: {
  tripId: string;
  tripName: string;
  currentUrl: string | null;
  onClose: () => void;
}) {
  const setImage = useSetChatImage(tripId);
  const removeImage = useRemoveChatImage(tripId);
  const [error, setError] = useState<string | null>(null);

  /*
   * The dialog closes on success and stays open on failure.
   *
   * A picker that closed either way would report an upload that did not happen,
   * and the reader's only clue would be a circle that never changed. The error
   * is the server's own sentence — it is the one that knows whether the file
   * was too big, the wrong type, or unreadable.
   */
  function save(file: File) {
    setError(null);
    setImage.mutate(file, {
      onSuccess: () => onClose(),
      onError: (e) => setError(e.message),
    });
  }

  function remove() {
    setError(null);
    removeImage.mutate(undefined, {
      onSuccess: () => onClose(),
      onError: (e) => setError(e.message),
    });
  }

  const busy = setImage.isPending || removeImage.isPending;

  return (
    <Dialog title={t("Chat picture")} eyebrow={tripName} onClose={onClose}>
      <ImagePicker
        label={t("Chat picture")}
        labelHidden
        centred
        cropCircle
        currentUrl={currentUrl}
        busy={busy}
        error={error}
        onSave={save}
        // Only offered when there is one to take away, so the dialog does not
        // show a control for undoing something that has not been done.
        onRemove={currentUrl ? remove : undefined}
      />
      <p className="board__panel-note">
        {t("Everyone on this board sees it, wherever the chat appears.")}
      </p>
    </Dialog>
  );
}
