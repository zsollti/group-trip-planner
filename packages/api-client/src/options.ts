import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateOptionInput,
  LockOptionInput,
  OptionView,
  UpdateOptionInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";
import { categoryKeys } from "./categories.js";
import { tripKeys } from "./trips.js";
import { dashboardKeys } from "./dashboard.js";

/** Query-key factory for a category's options. */
export const optionKeys = {
  all: ["options"] as const,
  list: (tripId: string, categoryId: string) =>
    [...optionKeys.all, "list", tripId, categoryId] as const,
};

function optionsPath(tripId: string, categoryId: string): string {
  return `/trips/${tripId}/categories/${categoryId}/options`;
}

/** A category's live options (any member). */
export function useCategoryOptions(
  tripId: string | undefined,
  categoryId: string | undefined,
): UseQueryResult<OptionView[], ApiError> {
  return useQuery({
    queryKey: optionKeys.list(tripId ?? "", categoryId ?? ""),
    queryFn: () => apiFetch<OptionView[]>(optionsPath(tripId!, categoryId!)),
    enabled: Boolean(tripId) && Boolean(categoryId),
  });
}

/** Propose an option (Participant+); refreshes the category's option list. */
export function useProposeOption(
  tripId: string,
  categoryId: string,
): UseMutationResult<OptionView, ApiError, CreateOptionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOptionInput) =>
      apiFetch<OptionView>(optionsPath(tripId, categoryId), {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/**
 * Edit an option (proposer or Organizer). The caller passes the `version` they
 * last saw; a 409 {@link ApiError} means it changed underneath them (or the
 * option is locked) and the UI should reload.
 */
export function useEditOption(
  tripId: string,
  categoryId: string,
): UseMutationResult<
  OptionView,
  ApiError,
  { optionId: string } & UpdateOptionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, ...body }) =>
      apiFetch<OptionView>(`${optionsPath(tripId, categoryId)}/${optionId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/** Soft-delete an option (proposer or Organizer). */
export function useDeleteOption(
  tripId: string,
  categoryId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optionId: string) =>
      apiFetch<void>(`${optionsPath(tripId, categoryId)}/${optionId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/**
 * Lock an option (Organizers) — record the group's decision (Phase 2.4, FR-24).
 * The caller passes **both** the option's and the category's last-seen versions;
 * the backend applies the category-aware guard (decision 2). A 409 {@link
 * ApiError} means a concurrent locker won the race — the UI must reload and show
 * the current state, never optimistically flip. On success it invalidates the
 * option list **and** the category list (a single-choice lock bumps the
 * category's version, which the next lock needs fresh).
 */
export function useLockOption(
  tripId: string,
  categoryId: string,
): UseMutationResult<
  OptionView,
  ApiError,
  { optionId: string } & LockOptionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, ...body }) =>
      apiFetch<OptionView>(
        `${optionsPath(tripId, categoryId)}/${optionId}/lock`,
        { method: "POST", body },
      ),
    // Invalidate on settle (success OR error): a rejected lock (409) must refetch
    // so the UI shows the current state — the front-runner someone else locked.
    // The trip detail is refreshed too: locking a Dates option writes the trip's
    // dates + expiry (Phase 2.5).
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) });
      void qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/**
 * Unlock a locked option (Organizers), carrying its last-seen `version`. A 409
 * means it changed since — reload. Refreshes the option and category lists.
 */
export function useUnlockOption(
  tripId: string,
  categoryId: string,
): UseMutationResult<
  OptionView,
  ApiError,
  { optionId: string; version: number }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, version }) =>
      apiFetch<OptionView>(
        `${optionsPath(tripId, categoryId)}/${optionId}/unlock`,
        { method: "POST", body: { version } },
      ),
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) });
      void qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/**
 * Toggle the caller's approval vote on an option (Phase 2.3, FR-22). Casting is
 * a POST, retracting a DELETE; both are idempotent and return the option with
 * its refreshed public tally. The mutation takes the option's current
 * `viewerHasVoted` so one hook drives the toggle; on success it refreshes the
 * category's option list so every voter's tally stays consistent.
 */
export function useToggleVote(
  tripId: string,
  categoryId: string,
): UseMutationResult<
  OptionView,
  ApiError,
  { optionId: string; hasVoted: boolean }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, hasVoted }) =>
      apiFetch<OptionView>(
        `${optionsPath(tripId, categoryId)}/${optionId}/votes`,
        { method: hasVoted ? "DELETE" : "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      // A vote can change the front-runner, and therefore the projection.
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}
