import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { RegisterInput, passwordMeetsPolicy } from "@gtp/types";
import { ApiError, useAuth } from "@gtp/api-client";
import { safeNextPath } from "../lib/next";
import { t, tNode } from "../lib/i18n";
import { BrandLockup } from "../components/Brand";
import { PasswordField, PasswordMeter } from "../components/PasswordField";

/**
 * What this **form** asks for, which is one field more than the contract wants.
 *
 * The confirmation is a property of the typing, not of the account: the server
 * has no use for a second copy of a password it is about to hash, and sending
 * one would put the plaintext on the wire twice for nothing. So it is added
 * here, checked here, and dropped before the request — the shared
 * {@link RegisterInput} stays exactly what the API takes.
 *
 * `superRefine` rather than `refine` so the mismatch is reported **on the
 * confirm field**, under the box the reader has to fix, instead of as a
 * form-level complaint floating above two boxes that both look fine.
 */
const RegisterForm = RegisterInput.extend({
  confirmPassword: z.string(),
}).superRefine((val, ctx) => {
  if (val.confirmPassword !== val.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "Both passwords must be the same.",
    });
  }
});
type RegisterForm = z.infer<typeof RegisterForm>;

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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(RegisterForm) });

  // Watched rather than read at submit: the meter and the checklist follow
  // every keystroke, which is the entire point of having them.
  const password = watch("password") ?? "";

  const onSubmit = handleSubmit(async (form) => {
    setFormError(null);
    try {
      // The confirmation stops here. It is a property of the typing, not of the
      // account, and the server has no use for a second copy of a password it
      // is about to hash.
      const { confirmPassword, ...data } = form;
      void confirmPassword;
      await registerAccount(data);
      setDone(true);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t("Something went wrong"),
      );
    }
  });

  if (done) {
    return (
      <div className="board board--center">
        <div className="board__auth">
          <BrandLockup />
          <h1 className="board__title">{t("Check your inbox")}</h1>
          {/* Two short sentences, where there used to be a paragraph about the
              dev console. The second one is not filler: a verification mail is
              the single most spam-filtered thing this app sends, and "it never
              arrived" is nearly always "it arrived in the other folder". */}
          <p className="board__muted">
            {t("We've sent you a link to verify your email address.")}
          </p>
          <p className="board__muted">
            {t(
              "No sign of it? Have a look in your spam folder. It likes to hide there.",
            )}
          </p>
          <p className="board__alt">
            <Link to={loginHref}>{t("Back to sign in")}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="board board--center">
      <div className="board__auth">
        <BrandLockup />
        <h1 className="board__title">{t("Create account")}</h1>
        <form onSubmit={onSubmit} noValidate>
          <Field
            htmlFor="displayName"
            label={t("Nickname")}
            error={errors.displayName?.message}
          >
            <Input
              id="displayName"
              autoComplete="nickname"
              autoFocus
              invalid={Boolean(errors.displayName)}
              {...register("displayName")}
            />
          </Field>
          <Field
            htmlFor="email"
            label={t("Email")}
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
          {/*
           * No `error` on this one, and no `hint` either — the meter under it
           * says everything a message could, rule by rule, as it is typed. A
           * resolver error would repeat one of those five lines in different
           * words a beat later, which is how a form ends up telling you two
           * things about one box.
           */}
          <PasswordField
            id="password"
            label={t("Password")}
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register("password")}
          />
          <PasswordMeter password={password} />
          <PasswordField
            id="confirmPassword"
            label={t("Password again")}
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
          {formError ? (
            <p className="board__form-error" role="alert">
              {formError}
            </p>
          ) : null}
          {/*
           * Disabled until the password itself is acceptable, and only then.
           * The other fields are left to the resolver to complain about on
           * submit — a button that stays dead until an entire form is perfect
           * gives no reason for being dead. This one has five reasons on screen
           * directly above it.
           */}
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting || !passwordMeetsPolicy(password)}
          >
            {isSubmitting ? t("Creating…") : t("Create account")}
          </Button>
        </form>
        <p className="board__alt">
          {tNode("Already have an account? {link}", {
            link: <Link to={loginHref}>{t("Sign in")}</Link>,
          })}
        </p>
      </div>
    </div>
  );
}
