import { useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import {
  ROLE_RANK,
  type InviteRole,
  type InviteType,
  type InviteLinkView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useCreateInvite,
  useDisableInvite,
  useTripInvites,
} from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { GlobeIcon, LinkIcon } from "./icons";
import { RoleIcon } from "./RoleIcon";
import { t, tNode } from "../lib/i18n";
import { roleBlurb, roleLabel } from "../lib/roles";

const INVITE_ROLES: InviteRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER"];

function joinUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

/**
 * Whether a link can still be used, which is now the only thing the list asks
 * about one.
 *
 * It used to be three states with a word for each — Active, Used, Disabled —
 * printed beside every row. Two of those three describe a link that can never
 * do anything again: a revoked link is refused and a personal link is spent the
 * moment its one recipient joins. Kept on screen they were a growing list of
 * things you cannot act on, sitting above the handful you can, with the useful
 * rows pushed further down every time somebody accepted an invite. So the list
 * shows what is live and nothing else — which also means the row no longer
 * needs a word for a state it is now guaranteed to be in.
 *
 * The rows are not deleted on the server. A spent link is the record of how
 * somebody got here and the activity feed refers to it; this is a filter, not a
 * cleanup.
 */
function isLive(link: InviteLinkView): boolean {
  if (link.disabledAt) return false;
  if (link.type === "PERSONAL" && link.consumedAt) return false;
  return true;
}

/**
 * Board-paradigm invite surface: a floating card summoned from the on-canvas
 * "Invite" affordance. Explains the global-vs-personal distinction (FR-13) at
 * creation, then lists existing links with copy/disable. Roles are limited to
 * those below the caller's own, matching the API rule.
 */
export function InviteDialog({
  tripId,
  myRole,
  onClose,
}: {
  tripId: string;
  myRole: TripRole;
  onClose: () => void;
}) {
  const invites = useTripInvites(tripId);
  const createInvite = useCreateInvite(tripId);
  const disableInvite = useDisableInvite(tripId);
  // Read once, in one place: the heading, the empty state and the list are the
  // same fact three times, and filtering separately is how they come to
  // disagree about whether there is anything here.
  const live = (invites.data ?? []).filter(isLive);

  const allowedRoles = INVITE_ROLES.filter(
    (r) => ROLE_RANK[r] < ROLE_RANK[myRole],
  );
  const [type, setType] = useState<InviteType>("GLOBAL");
  const [role, setRole] = useState<InviteRole>(
    allowedRoles.includes("PARTICIPANT")
      ? "PARTICIPANT"
      : (allowedRoles[0] ?? "GUEST"),
  );
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      // Said here rather than left to the contract's own refusal, which comes
      // back as "Validation failed" with the detail in a field the form does
      // not read. Same rule; this is only where the reader is.
      if (type === "PERSONAL" && !email.trim()) {
        setFormError(t("A personal link needs the address it is for."));
        return;
      }
      await createInvite.mutateAsync({
        type,
        role,
        email: type === "PERSONAL" ? email.trim() : undefined,
      });
      setEmail("");
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t("Could not create the link"),
      );
    }
  }

  async function onCopy(link: InviteLinkView) {
    try {
      await navigator.clipboard.writeText(joinUrl(link.token));
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setFormError(t("Couldn't copy. Copy the link manually."));
    }
  }

  return (
    /* No eyebrow: it read "Invite" directly above "Invite people" — a heading
       with its own first word printed over it. */
    <Dialog title={t("Invite people")} onClose={onClose}>
      <>
        <form onSubmit={onCreate} noValidate>
          <fieldset className="board__radio-group">
            <legend className="board__field-label">{t("Link type")}</legend>
            {/* A mark before each kind, because the two differ in exactly one
                way and the words for it are nearly the same: a globe is "the
                web can have this", a chain link is "this one, for you". The
                sentences shrank to match — the old ones spent a clause each on
                rules (one per role, disable it anytime, used up after the first
                join) that the list of existing links underneath already shows
                by being a list of existing links. */}
            <label className="board__radio">
              <input
                type="radio"
                name="type"
                checked={type === "GLOBAL"}
                onChange={() => setType("GLOBAL")}
              />
              <span>
                <GlobeIcon size={16} />{" "}
                {tNode("{kind}: anyone with the link can join.", {
                  kind: <strong>{t("Global")}</strong>,
                })}
              </span>
            </label>
            <label className="board__radio">
              <input
                type="radio"
                name="type"
                checked={type === "PERSONAL"}
                onChange={() => setType("PERSONAL")}
              />
              <span>
                <LinkIcon size={16} />{" "}
                {tNode("{kind}: for one address, and only that address.", {
                  kind: <strong>{t("Personal")}</strong>,
                })}
              </span>
            </label>
          </fieldset>

          {/*
           * The role, in the shape the question above it already uses.
           *
           * It was a `<select>` with a sentence underneath that changed as the
           * selection did — so the three answers could not be compared, only
           * visited: to find out what a Traveler is you had to *choose*
           * Traveler, and the guess that costs something here is handing an
           * Organizer link to somebody who should have had a Traveler one. The
           * two questions on this form are the same kind of question, so they
           * are now the same control.
           *
           * The height it costs is the point. Three sentences at once is what
           * makes them a comparison.
           */}
          <fieldset className="board__radio-group">
            <legend className="board__field-label">{t("Role granted")}</legend>
            {allowedRoles.map((r) => (
              <label className="board__radio" key={r}>
                <input
                  type="radio"
                  name="role"
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                {/* One line, in the shape the link-type radios above already
                    use: a mark, the name, a colon, the sentence. It used to be
                    two — the name on its own line with the sentence stacked
                    under it — which made two questions that are the same
                    question look like two different kinds of control, one
                    listing options and one listing paragraphs. The blurbs are
                    written to be read after the colon (see `roleBlurb`). */}
                <span>
                  <RoleIcon role={r} size={16} />{" "}
                  {tNode("{kind}: {blurb}", {
                    kind: <strong>{roleLabel(r)}</strong>,
                    blurb: roleBlurb(r),
                  })}
                </span>
              </label>
            ))}
          </fieldset>

          {type === "PERSONAL" ? (
            <Field
              htmlFor="invite-email"
              label={t("Email")}
              required
              hint={t(
                "We'll email the link, and only this address can use it.",
              )}
            >
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="friend@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          ) : null}

          {formError ? (
            <p className="board__form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="board__dialog-actions">
            <Button
              type="submit"
              variant="primary"
              disabled={createInvite.isPending}
            >
              {createInvite.isPending ? t("Creating…") : t("Create link")}
            </Button>
          </div>
        </form>

        <div className="board__invite-list">
          {/* The heading only where there is a list under it. With nothing to
              show it was a label over an apology. */}
          {live.length > 0 ? (
            <p className="board__eyebrow">{t("Existing links")}</p>
          ) : null}
          {invites.isPending ? (
            <p className="board__muted" role="status">
              {t("Loading links…")}
            </p>
          ) : invites.isError ? (
            <>
              <p className="board__form-error" role="alert">
                {t("Couldn't load invite links.")}
              </p>
              <button
                type="button"
                className="board__cta"
                onClick={() => void invites.refetch()}
              >
                {t("Try again")}
              </button>
            </>
          ) : live.length === 0 ? (
            <p className="board__muted">
              {t("No links to show. Create one above.")}
            </p>
          ) : (
            <ul className="board__invite-items">
              {live.map((link) => (
                <li key={link.id} className="board__invite-item">
                  <div>
                    <strong>{roleLabel(link.role)}</strong>{" "}
                    <span className="board__muted">
                      {link.type === "GLOBAL" ? t("Global") : t("Personal")}
                      {link.sentToEmail ? ` · ${link.sentToEmail}` : ""}
                    </span>
                  </div>
                  <div className="board__invite-item-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onCopy(link)}
                    >
                      {copiedId === link.id ? t("Copied!") : t("Copy link")}
                    </Button>
                    {/* "Remove", because the row goes when it is pressed. It
                        said "Disable" while the disabled rows stayed on screen
                        wearing the word; now that they do not, the name of the
                        button and what the reader sees happen are the same
                        thing. The link itself is revoked rather than deleted —
                        see `isLive`. */}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={disableInvite.isPending}
                      onClick={() => disableInvite.mutate(link.id)}
                    >
                      {t("Remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    </Dialog>
  );
}
