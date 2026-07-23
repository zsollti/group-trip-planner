import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { LoginInput } from "@gtp/types";
import { ApiError, googleSignInUrl, useAuth } from "@gtp/api-client";
import { safeNextPath } from "../lib/next";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Where to land after auth — e.g. an invite the user arrived on while logged
  // out (`/login?next=/join/:token`). Clamped to internal paths (no open redirect).
  const next = safeNextPath(params.get("next"));
  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";
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
    <main className="deck deck--auth">
      <div className="deck__auth-card">
        <p className="deck__eyebrow">Command Deck</p>
        <h1 className="deck__title">Sign in</h1>
        <form onSubmit={onSubmit} noValidate>
          <Field htmlFor="email" label="Email" error={errors.email?.message}>
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
            label="Password"
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
            <p className="deck__form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="deck__auth-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            window.location.href = googleSignInUrl();
          }}
        >
          Continue with Google
        </Button>
        <p className="deck__auth-alt">
          No account? <Link to={registerHref}>Create one</Link>
        </p>
      </div>
    </main>
  );
}
