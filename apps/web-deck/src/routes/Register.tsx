import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { RegisterInput } from "@gtp/types";
import { ApiError, useAuth } from "@gtp/api-client";

export function Register() {
  const { register: registerAccount } = useAuth();
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
      <main className="deck deck--auth">
        <div className="deck__auth-card">
          <p className="deck__eyebrow">Command Deck</p>
          <h1 className="deck__title">Check your inbox</h1>
          <p className="deck__lede">
            We sent a verification link. In local dev the link is printed to the
            API console — open it, then sign in.
          </p>
          <p className="deck__auth-alt">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="deck deck--auth">
      <div className="deck__auth-card">
        <p className="deck__eyebrow">Command Deck</p>
        <h1 className="deck__title">Create account</h1>
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
            <p className="deck__form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create account"}
          </Button>
        </form>
        <p className="deck__auth-alt">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
