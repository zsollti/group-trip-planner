import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * Low-level button primitive shared by all three apps. Intentionally unstyled
 * beyond a data-attribute hook — each app themes `[data-gtp-button]` with its
 * own tokens (§0b: shared primitives, per-app styling). Real styling lands with
 * the design tokens in Phase 0.7.
 */
export function Button({ variant = "primary", ...props }: ButtonProps) {
  return <button data-gtp-button data-variant={variant} {...props} />;
}
