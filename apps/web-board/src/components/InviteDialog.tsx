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
import { t, tNode } from "../lib/i18n";
import { roleBlurb, roleLabel } from "../lib/roles";

const INVITE_ROLES: InviteRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER"];

function joinUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

/**
 * A link's state as a **code**, which the list also branches on. Deliberately not
 * translated: the moment it is, `linkStatus(link) === "Active"` starts depending on
 * the reader's language. {@link linkStatusLabel} is the half that is read.
 */
type LinkStatus = "Disabled" | "Used" | "Active";

function linkStatus(link: InviteLinkView): LinkStatus {
  if (link.disabledAt) return "Disabled";
  if (link.type === "PERSONAL" && link.consumedAt) return "Used";
  return "Active";
}

function linkStatusLabel(status: LinkStatus): string {
  switch (status) {
    case "Disabled":
      return t("Disabled");
    case "Used":
      return t("Used");
    case "Active":
      return t("Active");
  }
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
      await createInvite.mutateAsync({
        type,
        role,
        email: type === "PERSONAL" && email.trim() ? email.trim() : undefined,
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
      setFormError(t("Couldn't copy — copy the link manually."));
    }
  }

  return (
    /* No eyebrow: it read "Invite" directly above "Invite people to this
       board" — a heading with its own first word printed over it. */
    <Dialog title={t("Invite people to this board")} onClose={onClose}>
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
                {tNode("{kind} — anyone with the link can join.", {
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
                {tNode("{kind} — a single-use link for one person.", {
                  kind: <strong>{t("Personal")}</strong>,
                })}
              </span>
            </label>
          </fieldset>

          {/*
           * The role, and — under it — what that role can actually do.
           *
           * This picker used to be three words with nothing to choose between
           * them: an inviter who did not already know the permission matrix was
           * guessing, and the guess that costs something is handing an
           * Organizer link to somebody who should have had a Traveler one. The
           * blurb follows the selection rather than listing all three at once,
           * so the panel says one thing at a time and stays the height it was.
           */}
          <Field htmlFor="invite-role" label={t("Role granted")}>
            <select
              id="invite-role"
              className="board__select"
              value={role}
              aria-describedby="invite-role-blurb"
              onChange={(e) => setRole(e.target.value as InviteRole)}
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </Field>
          <p className="board__field-note" id="invite-role-blurb">
            {roleBlurb(role)}
          </p>

          {type === "PERSONAL" ? (
            <Field
              htmlFor="invite-email"
              label={t("Email (optional)")}
              hint="We'll email the link. It stays unbound — anyone who gets it can use it."
            >
              <Input
                id="invite-email"
                type="email"
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
          <p className="board__eyebrow">{t("Existing links")}</p>
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
          ) : invites.data.length === 0 ? (
            <p className="board__muted">
              {t("No links yet. Create one above.")}
            </p>
          ) : (
            <ul className="board__invite-items">
              {invites.data.map((link) => {
                const active = linkStatus(link) === "Active";
                return (
                  <li key={link.id} className="board__invite-item">
                    <div>
                      <strong>{roleLabel(link.role)}</strong>{" "}
                      <span className="board__muted">
                        {link.type === "GLOBAL" ? t("Global") : t("Personal")} ·{" "}
                        {linkStatusLabel(linkStatus(link))}
                        {link.sentToEmail ? ` · ${link.sentToEmail}` : ""}
                      </span>
                    </div>
                    <div className="board__invite-item-actions">
                      {active ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onCopy(link)}
                          >
                            {copiedId === link.id
                              ? t("Copied!")
                              : t("Copy link")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={disableInvite.isPending}
                            onClick={() => disableInvite.mutate(link.id)}
                          >
                            {t("Disable")}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </>
    </Dialog>
  );
}
