import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { RegisterInput } from "@gtp/types";
import { ApiError, useAuth } from "@gtp/api-client";
import { safeNextPath } from "../lib/next";

export function Register() {
  const { register: registerAccount } = useAuth();
  const [params] = useSearchParams();
  // Preserve an invite target across register → sign in.
  const next = safeNextPath(params.get("next"));
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(RegisterInput) });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await registerAccount(data);
      setDone(true);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
    }
  });

  if (done) {
    return (
      <div className="board board--center">
        <div className="board__auth">
          <p className="board__eyebrow">Trip Board</p>
          <h1 className="board__title">Check your inbox</h1>
          <p className="board__muted">
            We sent a verification link. In local dev it&apos;s printed to the
            API console — open it, then sign in.
          </p>
          <p className="board__alt">
            <Link to={loginHref}>Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="board board--center">
      <div className="board__auth">
        <p className="board__eyebrow">Trip Board</p>
        <h1 className="board__title">Create account</h1>
        <form onSubmit={onSubmit} noValidate>
          <Field
            htmlFor="displayName"
            label="Display name"
            error={errors.displayName?.message}
          >
            <Input
              id="displayName"
              autoComplete="name"
              autoFocus
              invalid={Boolean(errors.displayName)}
              {...register("displayName")}
            />
          </Field>
          <Field htmlFor="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </Field>
          <Field
            htmlFor="password"
            label="Password"
            error={errors.password?.message}
            hint="At least 8 characters."
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
            {isSubmitting ? "Creating…" : "Create account"}
          </Button>
        </form>
        <p className="board__alt">
          Already have an account? <Link to={loginHref}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
