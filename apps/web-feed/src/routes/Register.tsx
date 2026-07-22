import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { RegisterInput } from "@gtp/types";
import { ApiError, useAuth } from "@gtp/api-client";

// The Feed's signature: registration as a friendly one-thing-at-a-time wizard.
const STEPS = ["displayName", "email", "password"] as const;

export function Register() {
  const { register: registerAccount } = useAuth();
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(RegisterInput),
    mode: "onTouched",
  });

  const isLast = step === STEPS.length - 1;

  const next = async () => {
    const valid = await trigger(STEPS[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

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
      <div className="feed">
        <main className="feed__screen feed__center">
          <div className="feed__card-media">📬</div>
          <h1 className="feed__title">Check your inbox</h1>
          <p className="feed__muted">
            We sent you a verification link. In local dev it&apos;s printed to
            the API console — open it, then log in.
          </p>
          <p className="feed__alt">
            <Link to="/login">Back to log in</Link>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="feed">
      <main className="feed__screen">
        <p className="feed__eyebrow">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 className="feed__title">Create your account</h1>
        <form onSubmit={onSubmit} noValidate>
          {step === 0 ? (
            <Field
              htmlFor="displayName"
              label="What should we call you?"
              error={errors.displayName?.message}
            >
              <Input
                id="displayName"
                autoComplete="name"
                invalid={Boolean(errors.displayName)}
                {...register("displayName")}
              />
            </Field>
          ) : null}

          {step === 1 ? (
            <Field
              htmlFor="email"
              label="Your email"
              error={errors.email?.message}
            >
              <Input
                id="email"
                type="email"
                autoComplete="email"
                invalid={Boolean(errors.email)}
                {...register("email")}
              />
            </Field>
          ) : null}

          {step === 2 ? (
            <Field
              htmlFor="password"
              label="Pick a password"
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
          ) : null}

          {formError ? (
            <p className="feed__form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="feed__wizard-nav">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </Button>
            ) : null}
            {isLast ? (
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create account"}
              </Button>
            ) : (
              <Button type="button" variant="primary" onClick={next}>
                Continue
              </Button>
            )}
          </div>
        </form>
        <p className="feed__alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </main>
    </div>
  );
}
