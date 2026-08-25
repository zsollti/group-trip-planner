import type { ReactNode } from "react";

export interface FieldProps {
  /** Links the label to the control; pass the same value as the input's id. */
  htmlFor: string;
  label: string;
  /** Validation message; rendered with role="alert" when present. */
  error?: string;
  /** Optional helper/hint text shown under the control when there's no error. */
  hint?: string;
  /**
   * Mark the field as one that must be filled.
   *
   * Draws an asterisk after the label and nothing else — the *real* signal is
   * `required` on the control itself, which is what a screen reader and the
   * browser both read, so this is `aria-hidden` decoration for the eye. It
   * exists because the alternative convention, tagging every other label
   * "(optional)", spends a word on each of the many to say something about the
   * few, and the reader has to notice an absence to learn anything.
   */
  required?: boolean;
  /**
   * Keep the label for assistive technology and take it off the screen.
   *
   * For the case where the surrounding heading already says what the field is,
   * and printing it again directly underneath reads as two names for one box.
   * Never a way to ship an unlabelled control: the `<label>` is still rendered
   * and still associated, so a screen reader announces the field exactly as it
   * would otherwise.
   */
  labelHidden?: boolean;
  children: ReactNode;
}

/**
 * A labelled form field: label + control + error/hint. Keeps the a11y wiring
 * (label association, alert role) in one shared place; apps style
 * `[data-gtp-field]` per their tokens.
 */
export function Field({
  htmlFor,
  label,
  error,
  hint,
  required,
  labelHidden,
  children,
}: FieldProps) {
  return (
    <div data-gtp-field data-invalid={error ? true : undefined}>
      <label
        data-gtp-label
        data-hidden={labelHidden || undefined}
        htmlFor={htmlFor}
      >
        {label}
        {required ? (
          <span data-gtp-required aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p data-gtp-field-error role="alert" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p data-gtp-field-hint id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
