import { useState } from "react";
import {
  ApiError,
  useAuth,
  useUpdateProfile,
  useNotificationPreferences,
  useRemoveAvatar,
  useSetAvatar,
  useSetAvatarPreset,
  useUpdateNotificationPreferences,
} from "@gtp/api-client";
import {
  avatarPresetOf,
  type AvatarColour,
  LOCALES,
  LOCALE_LABEL,
  type AvatarPreset,
  type Locale,
} from "@gtp/types";
import { Brand } from "../components/Brand";
import { UserMenu } from "../components/UserMenu";
import { useLocale } from "../lib/useLocale";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { ImagePicker } from "../components/ImagePicker";
import { AvatarPresetPicker } from "../components/AvatarPresetPicker";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { t, tNode } from "../lib/i18n";

/**
 * The account settings page — your picture, your email preferences, and the
 * deletion of the whole account, in that order of how often they are wanted.
 * The per-trip mute lives on each board's menu, because that is where the
 * decision "this trip is too noisy" is actually made.
 *
 * The notification section covers all four states: loading, error (with a
 * retry), the loaded toggle, and a saving state on the control itself. There is
 * no empty state — preferences always exist, defaulted on.
 */
export function Settings() {
  const { user, applyUser } = useAuth();
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const setAvatar = useSetAvatar();
  const setAvatarPreset = useSetAvatarPreset();
  const removeAvatar = useRemoveAvatar();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // One column carries both, so the uploader's idea of "the current picture"
  // has to exclude the drawn marks — `preset:tent` is not an address it could
  // ever render. See the contract's `avatar.ts`.
  const uploadedAvatar = avatarPresetOf(user?.avatarUrl)
    ? null
    : (user?.avatarUrl ?? null);
  const busyAvatar =
    setAvatar.isPending || setAvatarPreset.isPending || removeAvatar.isPending;

  // Both avatar paths answer with the updated user, which goes straight into
  // the session so the header, chat and crew list follow without a refetch.
  async function saveAvatar(file: File) {
    setAvatarError(null);
    try {
      applyUser(await setAvatar.mutateAsync(file));
    } catch (err) {
      setAvatarError(
        err instanceof ApiError
          ? err.message
          : t("Couldn't upload that picture. Please try again."),
      );
    }
  }

  async function wearPreset(preset: AvatarPreset, colour: AvatarColour) {
    setAvatarError(null);
    try {
      applyUser(await setAvatarPreset.mutateAsync({ preset, colour }));
    } catch (err) {
      setAvatarError(
        err instanceof ApiError
          ? err.message
          : t("Couldn't set that picture. Please try again."),
      );
    }
  }

  async function clearAvatar() {
    setAvatarError(null);
    try {
      applyUser(await removeAvatar.mutateAsync());
    } catch (err) {
      setAvatarError(
        err instanceof ApiError
          ? err.message
          : t("Couldn't remove your picture. Please try again."),
      );
    }
  }

  async function setEmailOnMention(next: boolean) {
    setError(null);
    try {
      await update.mutateAsync({ emailOnMention: next });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t("Couldn't save that. Please try again."),
      );
    }
  }

  return (
    <main className="board">
      <header className="board__bar">
        <Brand />
        <div className="board__bar-actions">
          <UserMenu />
        </div>
      </header>

      {/* The measure, off the <main> so the bar above it spans the window
          on every page alike — see `.board__measure`. */}
      <div className="board__measure">
        <h1 className="board__title board__title--center">
          {t("Your settings")}
        </h1>

        <NameSection />
        <LanguageSection />

        <section className="board__panel" aria-labelledby="avatar-heading">
          <h2 className="board__panel-title" id="avatar-heading">
            {t("Profile picture")}
          </h2>
          <ImagePicker
            // The heading directly above this reads "Profile picture", so a
            // second line under it reading "Your picture" was two names for one
            // thing with nothing between them but the gap. Hidden rather than
            // dropped: it is also the file input's accessible name.
            label={t("Your picture")}
            labelHidden
            centred
            shape="square"
            // A `preset:` value is not an address the preview can load, so the
            // uploader is told there is no picture — which is true of the thing
            // *it* manages. The mark itself is shown by the grid below, where
            // it is also the current selection.
            currentUrl={uploadedAvatar}
            busy={busyAvatar}
            error={avatarError}
            // The circle is chosen before the upload: the server resizes to fit
            // and CSS then crops to the middle, so an off-centre face used to
            // become a picture of a shoulder.
            cropCircle
            onSave={(file) => void saveAvatar(file)}
            onRemove={user?.avatarUrl ? () => void clearAvatar() : undefined}
          />
          <p className="board__panel-note">
            {t(
              "Shown wherever you appear: the crew list and board chat. Without one, your initials stand in.",
            )}
          </p>
          <AvatarPresetPicker
            name={user?.displayName ?? ""}
            userId={user?.id}
            currentUrl={user?.avatarUrl ?? null}
            busy={busyAvatar}
            onPick={(preset, colour) => void wearPreset(preset, colour)}
          />
        </section>

        {prefs.isPending ? (
          <p className="board__muted">{t("Loading your settings…")}</p>
        ) : prefs.isError ? (
          <>
            <p className="board__form-error" role="alert">
              {t("Couldn't load your settings.")}
            </p>
            <button
              type="button"
              className="board__cta"
              onClick={() => void prefs.refetch()}
            >
              {t("Try again")}
            </button>
          </>
        ) : (
          <section
            className="board__panel"
            aria-labelledby="email-prefs-heading"
          >
            <h2 className="board__panel-title" id="email-prefs-heading">
              {t("Notifications")}
            </h2>
            {error ? (
              <p className="board__form-error" role="alert">
                {error}
              </p>
            ) : null}
            <ToggleSwitch
              label={t("Email me when I'm @mentioned")}
              description={t(
                "Someone naming you in a board's chat sends you an email. Turn this off and mentions still show up in the app.",
              )}
              checked={prefs.data.emailOnMention}
              pending={update.isPending}
              onChange={(next) => void setEmailOnMention(next)}
            />
            <p className="board__panel-note">
              {t(
                "Account emails are always sent, and these settings never affect them. That covers verifying your address and signing in.",
              )}
            </p>
            <p className="board__panel-note">
              {tNode(
                "To silence a single noisy board, open it and use {control} in its ⋯ menu.",
                { control: <strong>{t("Mute email")}</strong> },
              )}
            </p>
          </section>
        )}

        {/* Deliberately last, and deliberately not in the header menu it used to
          live in: an account is deleted at most once, and the control for it
          does not belong one slip of the pointer away from "Log out". Outside
          the preferences branch above, so a failed preferences load cannot take
          it down with it. */}
        <section
          className="board__panel board__panel--danger"
          aria-labelledby="danger-heading"
        >
          <h2 className="board__panel-title" id="danger-heading">
            {t("Danger zone")}
          </h2>
          <p className="board__panel-note">
            {t(
              "Deleting your account removes your personal data for good. Boards you own pass to another member, or are deleted if you're the only one on them. The next screen names them before anything happens.",
            )}
          </p>
          <div className="board__panel-action">
            <button
              type="button"
              className="board__cta board__cta--danger"
              onClick={() => setDeleteAccountOpen(true)}
            >
              {t("Delete account…")}
            </button>
          </div>
        </section>

        {deleteAccountOpen ? (
          <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
        ) : null}
      </div>
    </main>
  );
}

/**
 * The language the app is read in.
 *
 * It lives on the account rather than in this browser, so the same reader gets
 * the same language on their phone as on their laptop. `localStorage` mirrors it
 * (see `LocaleProvider`) only so the screens *outside* a session — sign-in,
 * register, the invite-join page — have something to go on.
 *
 * The section states the current language even when there is only one to be in.
 * That is not decoration: it is the one place the choice will appear, and saying
 * "English" today is how a reader learns that the app has a language at all
 * rather than wondering whether it has a setting they cannot find. The picker
 * itself appears when there is something to pick, which is a dictionary away.
 */
function LanguageSection() {
  const { applyUser } = useAuth();
  const { locale } = useLocale();
  const update = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);

  async function choose(next: Locale) {
    if (next === locale) return;
    setError(null);
    try {
      // Straight into the session, which is what `LocaleProvider` reads — so the
      // page repaints in the new language on the same tick, with no refetch and
      // no reload.
      applyUser(await update.mutateAsync({ locale: next }));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t("Couldn't change the language."),
      );
    }
  }

  return (
    <section className="board__panel" aria-labelledby="language-heading">
      <h2 className="board__panel-title" id="language-heading">
        {t("Language")}
      </h2>
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      {LOCALES.length > 1 ? (
        <div
          className="settings__languages"
          role="radiogroup"
          aria-labelledby="language-heading"
        >
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === locale}
              className="settings__language"
              disabled={update.isPending}
              onClick={() => void choose(l)}
            >
              {LOCALE_LABEL[l]}
            </button>
          ))}
        </div>
      ) : (
        <p className="board__panel-note">
          {tNode(
            "This app is in {language}. It is the only language available so far.",
            { language: <strong>{LOCALE_LABEL[locale]}</strong> },
          )}
        </p>
      )}
    </section>
  );
}

/**
 * Your nickname, as everyone else sees it.
 *
 * It was set at registration and then frozen: no screen in the app could change
 * it, and it is the name attached to every proposal, vote and message you have
 * ever made. An account created in a hurry wore that name to the whole group
 * permanently.
 *
 * Saving pushes the updated user straight into the session, so the header
 * avatar and every list that reads a name follow immediately — the same route
 * the avatar upload already takes.
 */
function NameSection() {
  const { user, applyUser } = useAuth();
  const update = useUpdateProfile();
  const [name, setName] = useState(user?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();
  // Nothing to do when it is empty or unchanged. Checked on the trimmed value
  // because " Ada " and "Ada" are the same name, and the server stores the
  // trimmed one — without this, adding a space would offer a save that
  // appears to do nothing.
  const dirty = trimmed !== "" && trimmed !== user?.displayName;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      applyUser(await update.mutateAsync({ displayName: trimmed }));
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("Couldn't save that name."),
      );
    }
  }

  return (
    <section className="board__panel" aria-labelledby="name-heading">
      <h2 className="board__panel-title" id="name-heading">
        {t("Nickname")}
      </h2>
      <form className="settings__name" onSubmit={(e) => void onSubmit(e)}>
        {/* The label is hidden, not dropped. The heading directly above says
            "Nickname" already, and a second copy of that word under it was one
            name too many for one box — but a control with no label at all is
            unreadable to anyone not looking at the heading, so the `<label>`
            stays and only leaves the screen. */}
        <Field
          htmlFor="displayName"
          label={t("Nickname")}
          labelHidden
          error={error ?? undefined}
        >
          <Input
            id="displayName"
            value={name}
            maxLength={80}
            invalid={Boolean(error)}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? t("Saving…") : t("Save")}
        </Button>
      </form>
      {/* Only the confirmation. The standing description under this box - what
          a nickname is shown on - was explaining a field whose heading, value
          and Save button already say the whole thing, so it was a line of prose
          the reader had to skip every visit. Feedback after an edit is a
          different matter: nothing else on screen changes when a save lands. */}
      {saved ? (
        <p className="board__panel-note" role="status">
          {t("Saved. Everyone on your boards sees the new name.")}
        </p>
      ) : null}
    </section>
  );
}
