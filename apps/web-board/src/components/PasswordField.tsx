import { useId, useState } from "react";
import { Field, Input, type InputProps } from "@gtp/ui-primitives";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_STRONG_BITS,
  passwordBits,
  passwordRules,
  passwordStrength,
  type PasswordRuleId,
  type PasswordStrength,
} from "@gtp/types";
import { Glyph } from "./icons";
import { t } from "../lib/i18n";

/**
 * A password box you can look at.
 *
 * Every password field in this app was a plain `type="password"`, which is the
 * default for good reasons and wrong for one: the person typing cannot tell a
 * typo from a working password, and the usual remedy — type it again in a
 * second box — only catches the case where you make the *same* mistake twice.
 * So the box holds a reveal, and the confirmation box beside it (see
 * {@link Register}) catches the rest.
 *
 * The toggle is a real `<button>` inside the field rather than a checkbox
 * beside it, and it says which way it will go ("Show password" / "Hide
 * password") rather than naming its current state — a control labelled with
 * what it *is* leaves the reader to work out what pressing it does.
 *
 * It never changes `autoComplete`, so a password manager keeps filling it
 * whichever way it is showing.
 */
export function PasswordField({
  id,
  label,
  error,
  hint,
  ...input
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
} & Omit<InputProps, "id" | "type">) {
  const [shown, setShown] = useState(false);

  return (
    <Field htmlFor={id} label={label} error={error} hint={hint}>
      <span className="pw__box">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          invalid={Boolean(error)}
          {...input}
        />
        <button
          type="button"
          className="pw__reveal"
          // Not a submit, and not a tab stop the keyboard has to step over on
          // the way from the password to the button that uses it: a reader who
          // wants this can reach it, and one filling the form is not detoured
          // through it twice.
          tabIndex={-1}
          aria-label={shown ? t("Hide password") : t("Show password")}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <EyeIcon off={shown} />
        </button>
      </span>
    </Field>
  );
}

/**
 * The eye, and the eye struck through.
 *
 * Struck through when the password is *showing*, which is the convention worth
 * following even though both readings are defensible: the icon says what the
 * button does next, matching its label.
 */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <Glyph size={18}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 20 20 4" /> : null}
    </Glyph>
  );
}

/** What each gate asks for, in the reader's language. */
function ruleLabel(id: PasswordRuleId): string {
  switch (id) {
    case "length":
      return t("At least {n} characters", { n: PASSWORD_MIN_LENGTH });
    case "lowercase":
      return t("A lowercase letter");
    case "uppercase":
      return t("An uppercase letter");
    case "number":
      return t("A number");
    case "special":
      return t("A special character");
  }
}

/** The one word under the bar. */
function strengthLabel(strength: PasswordStrength): string {
  switch (strength) {
    case "weak":
      return t("Weak");
    case "normal":
      return t("Normal");
    case "strong":
      return t("Strong");
  }
}

/**
 * How good the password is, and what it is still missing.
 *
 * Two different things, deliberately drawn as two: the **checklist** is the
 * gate — every line red until it is met, and nothing is submitted while one is
 * red — and the **bar** is advice about a password that has already cleared
 * them all, or is on its way. Merging them into one meter is the common design
 * and it is the one that misleads: a bar three-fifths full says "nearly there"
 * about a password that will be refused outright.
 *
 * Both are computed by {@link passwordRules} and {@link passwordBits} from
 * `@gtp/types` — the same functions `passwordSchema` is built from, so the
 * ticks here can never disagree with what the server will accept.
 *
 * Rendered from the first keystroke and not before. An empty box is not a
 * failing password, and painting five red lines at someone who has not typed
 * anything is telling them off for the form's own initial state.
 */
export function PasswordMeter({ password }: { password: string }) {
  const rules = passwordRules(password);
  const strength = passwordStrength(password);
  const bits = passwordBits(password);
  const headingId = useId();

  if (password === "") return null;

  // A fraction of "strong", clamped — the bar is a reading of the estimate, not
  // three fixed widths, so an extra character visibly moves it.
  const fill = Math.min(100, Math.round((bits / PASSWORD_STRONG_BITS) * 100));

  return (
    <div className="pw__meter">
      <div className="pw__strength">
        <span
          className="pw__bar"
          // The bar is decoration over the word beside it; announcing a
          // percentage as well would say the same thing twice, worse.
          aria-hidden="true"
        >
          <span
            className="pw__bar-fill"
            data-strength={strength}
            style={{ width: `${fill}%` }}
          />
        </span>
        <span className="pw__word" data-strength={strength} role="status">
          {strengthLabel(strength)}
        </span>
      </div>

      <p className="pw__rules-head" id={headingId}>
        {t("Your password needs")}
      </p>
      <ul className="pw__rules" aria-labelledby={headingId}>
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="pw__rule"
            data-met={rule.met || undefined}
          >
            {/* The mark carries the answer for anyone who cannot see the
                colour — red and green alone is the single most common way a
                checklist like this fails a colourblind reader. */}
            <span className="pw__mark" aria-hidden="true">
              {rule.met ? "✓" : "✗"}
            </span>
            <span className="board__sr-only">
              {rule.met ? t("Done:") : t("Still needed:")}{" "}
            </span>
            {ruleLabel(rule.id)}
          </li>
        ))}
      </ul>
    </div>
  );
}
