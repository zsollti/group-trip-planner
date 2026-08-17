import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { LoginInput } from "@gtp/types";
import {
  ApiError,
  googleSignInUrl,
  OAUTH_RETURN_GOOGLE,
  OAUTH_RETURN_MARKER,
  useAuth,
} from "@gtp/api-client";
import { safeNextPath } from "../lib/next";
import { t, tNode } from "../lib/i18n";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Post-auth destination — e.g. an invite arrived on while logged out.
  const next = safeNextPath(params.get("next"));
  const registerHref = next
    ? `/register?next=${encodeURIComponent(next)}`
    : "/register";
  // Reaching the sign-in card *with* the OAuth return marker means the provider
  // round-trip finished but the session didn't survive it — the silent refresh
  // couldn't read its cookie. Without this the page looks like a fresh visit and
  // the failure is invisible (which is exactly how it presented on mobile).
  const oauthFailed = params.get(OAUTH_RETURN_MARKER) === OAUTH_RETURN_GOOGLE;
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginInput) });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await login(data);
      navigate(next ?? "/");
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
    }
  });

  return (
    <div className="board board--center">
      <div className="board__auth">
        <p className="board__eyebrow">{t("Trip Board")}</p>
        <h1 className="board__title">{t("Sign in")}</h1>
        {oauthFailed ? (
          <p className="board__form-error" role="alert">
            {t(
              "Google sign-in didn't complete. Your browser may be blocking cookies set by the API — try again, or sign in with your email and password.",
            )}
          </p>
        ) : null}
        <form onSubmit={onSubmit} noValidate>
          <Field
            htmlFor="email"
            label={t("Email")}
            error={errors.email?.message}
          >
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </Field>
          <Field
            htmlFor="password"
            label={t("Password")}
            error={errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              invalid={Boolean(errors.password)}
              {...register("password")}
            />
          </Field>
          {formError ? (
            <p className="board__form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="board__auth-divider" aria-hidden="true">
          <span>{t("or")}</span>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            window.location.href = googleSignInUrl(next);
          }}
        >
          {t("Continue with Google")}
        </Button>
        <p className="board__alt">
          {tNode("No account? {link}", {
            link: <Link to={registerHref}>{t("Create one")}</Link>,
          })}
        </p>
      </div>
    </div>
  );
}
