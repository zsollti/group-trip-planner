import { Button } from "@gtp/ui-primitives";
import {
  memberActionQuestion,
  type PendingMemberAction,
} from "../lib/memberActions";
import { t } from "../lib/i18n";

/**
 * The last word before one of the three acts that cannot be taken back.
 *
 * Shared by the members dialog and the crew panel's quick actions, because the
 * sentence is the thing that has to be identical: "remove" and "remove and
 * block" are the same act with a different afterwards, and neither the verbs
 * nor a pair of icons carries that on its own. The question says what happens
 * *and* what happens next, in those words, however the reader got here.
 */
export function MemberConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingMemberAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="board__dialog-actions board__dialog-actions--stack">
      <p className="board__muted">{memberActionQuestion(pending)}</p>
      <div className="board__dialog-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="button" variant="primary" onClick={onConfirm}>
          {pending.kind === "transfer" ? t("Transfer ownership") : t("Confirm")}
        </Button>
      </div>
    </div>
  );
}
