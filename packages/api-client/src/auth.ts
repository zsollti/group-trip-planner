import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type {
  AuthUser,
  LoginInput,
  LoginResult,
  RegisterInput,
  RegisterResult,
  VerifyEmailInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/**
 * Typed auth mutations shared by all three front-ends. The input/output types
 * come straight from @gtp/types, so a contract change that isn't matched in a
 * caller fails the typecheck. The endpoints themselves land in Phase 0.6.
 */

export function useRegister(): UseMutationResult<
  RegisterResult,
  ApiError,
  RegisterInput
> {
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiFetch<RegisterResult>("/auth/register", {
        method: "POST",
        body: input,
      }),
  });
}

export function useLogin(): UseMutationResult<
  LoginResult,
  ApiError,
  LoginInput
> {
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<LoginResult>("/auth/login", { method: "POST", body: input }),
  });
}

export function useVerifyEmail(): UseMutationResult<
  AuthUser,
  ApiError,
  VerifyEmailInput
> {
  return useMutation({
    mutationFn: (input: VerifyEmailInput) =>
      apiFetch<AuthUser>("/auth/verify", { method: "POST", body: input }),
  });
}
