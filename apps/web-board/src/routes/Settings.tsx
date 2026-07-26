import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@gtp/api-client";
import { UserMenu } from "../components/UserMenu";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { ToggleSwitch } from "../components/ToggleSwitch";

/**
 * Notification settings (Phase 5.3) — the global half of the preference story.
 * The per-trip mute lives on each board's menu, because that is where the
 * decision "this trip is too noisy" is actually made.
 *
 * Covers all four states: loading, error (with a retry), the loaded toggle, and
 * a saving state on the control itself. There is no empty state — preferences
 * always exist, defaulted on.
 */
export function Settings() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setEmailOnMention(next: boolean) {
    setError(null);
    try {
      await update.mutateAsync({ emailOnMention: next });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't save that. Please try again.",
      );
    }
  }

  return (
    <main className="board">
      <header className="board__bar">
        <Link className="board__brand board__brand--link" to="/">
          ‹ Boards
        </Link>
        <div className="board__bar-actions">
          <UserMenu onDeleteAccount={() => setDeleteAccountOpen(true)} />
        </div>
      </header>

      <p className="board__eyebrow">Account</p>
      <h1 className="board__title">Notification settings</h1>

      {prefs.isPending ? (
        <p className="board__muted">Loading your settings…</p>
      ) : prefs.isError ? (
        <>
          <p className="board__form-error" role="alert">
            Couldn't load your settings.
          </p>
          <button
            type="button"
            className="board__cta"
            onClick={() => void prefs.refetch()}
          >
            Try again
          </button>
        </>
      ) : (
        <section className="board__panel" aria-labelledby="email-prefs-heading">
          <h2 className="board__panel-title" id="email-prefs-heading">
            Email
          </h2>
          {error ? (
            <p className="board__form-error" role="alert">
              {error}
            </p>
          ) : null}
          <ToggleSwitch
            label="Email me when I'm @mentioned"
            description="Someone naming you in a board's chat sends you an email. Turn this off and mentions still show up in the app."
            checked={prefs.data.emailOnMention}
            pending={update.isPending}
            onChange={(next) => void setEmailOnMention(next)}
          />
          <p className="board__panel-note">
            Account emails — verifying your address, signing in — are always
            sent, and these settings never affect them.
          </p>
          <p className="board__panel-note">
            To silence a single noisy board, open it and use{" "}
            <strong>Mute email</strong> in its ⋯ menu.
          </p>
        </section>
      )}

      {deleteAccountOpen ? (
        <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
      ) : null}
    </main>
  );
}
