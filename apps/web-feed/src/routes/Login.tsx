import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { LoginInput } from "@gtp/types";
import { ApiError, useAuth } from "@gtp/api-client";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      navigate("/");
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
    }
  });

  return (
    <div className="feed">
      <main className="feed__screen">
        <p className="feed__eyebrow">Trip Feed</p>
        <h1 className="feed__title">Welcome back</h1>
        <form onSubmit={onSubmit} noValidate>
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
            <p className="feed__form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Log in"}
          </Button>
        </form>
        <p className="feed__alt">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </main>
    </div>
  );
}
