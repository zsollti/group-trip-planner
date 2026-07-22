import type { ReactNode } from "react";

export interface FieldProps {
  /** Links the label to the control; pass the same value as the input's id. */
  htmlFor: string;
  label: string;
  /** Validation message; rendered with role="alert" when present. */
  error?: string;
  /** Optional helper/hint text shown under the control when there's no error. */
  hint?: string;
  children: ReactNode;
}

/**
 * A labelled form field: label + control + error/hint. Keeps the a11y wiring
 * (label association, alert role) in one shared place; apps style
 * `[data-gtp-field]` per their tokens.
 */
export function Field({ htmlFor, label, error, hint, children }: FieldProps) {
  return (
    <div data-gtp-field data-invalid={error ? true : undefined}>
      <label data-gtp-label htmlFor={htmlFor}>
        {label}
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
