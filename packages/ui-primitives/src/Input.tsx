import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Low-level text input shared by all three apps. forwardRef so react-hook-form
 * can register it. Unstyled beyond data-attributes — each app themes
 * `[data-gtp-input]` with its own tokens (§0b).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      data-gtp-input
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});
