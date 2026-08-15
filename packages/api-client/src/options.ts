import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateOptionInput,
  LockOptionInput,
  OptionView,
  ReorderOptionsInput,
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

/**
 * Options for several categories at once (Phase 3.5) — the board lifts every
 * lane's options to the canvas so it can render a **global "Decided" column** of
 * locked picks alongside the proposed cards. Each query shares
 * {@link optionKeys.list}, so it dedupes with any per-lane `useCategoryOptions`
 * and stays consistent under the same invalidations. Returns the options grouped
 * by category id plus rolled-up pending/error flags.
 */
export function useCategoriesOptions(
  tripId: string,
  categoryIds: string[],
): {
  byCategory: Record<string, OptionView[]>;
  isPending: boolean;
  isError: boolean;
} {
  const results = useQueries({
    queries: categoryIds.map((categoryId) => ({
      queryKey: optionKeys.list(tripId, categoryId),
      queryFn: () => apiFetch<OptionView[]>(optionsPath(tripId, categoryId)),
      enabled: Boolean(tripId) && Boolean(categoryId),
    })),
  });
  const byCategory: Record<string, OptionView[]> = {};
  categoryIds.forEach((categoryId, i) => {
    byCategory[categoryId] = results[i]?.data ?? [];
  });
  return {
    byCategory,
    isPending: results.some((r) => r.isPending),
    isError: results.some((r) => r.isError),
  };
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
 * Reorder a category's options (Organizers, Phase 3.5 — the board's
 * drag-to-reorder gesture). The caller sends the full set of the category's live
 * option ids in the desired order; the server reassigns `position` by index. On
 * success it refreshes the option list. Reordering is display-only, so nothing
 * else (cost, votes, category) needs invalidating.
 */
export function useReorderOptions(
  tripId: string,
  categoryId: string,
): UseMutationResult<OptionView[], ApiError, ReorderOptionsInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReorderOptionsInput) =>
      apiFetch<OptionView[]>(`${optionsPath(tripId, categoryId)}/reorder`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
    },
  });
}

/**
 * Board drag-and-drop mutations (Phase 3.5). The board's single `DndContext`
 * resolves the target category only at drop time, so these trip-scoped hooks take
 * the `categoryId` in their variables (unlike the per-category hooks above) and
 * invalidate the right lane afterward. They wrap the exact same endpoints as the
 * button controls — drag is a second path to the same actions, never a new one.
 */

/** Lock an option by dragging it into the Decided column (Organizers). */
export function useBoardLock(
  tripId: string,
): UseMutationResult<
  OptionView,
  ApiError,
  { categoryId: string; optionId: string } & LockOptionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, optionId, ...body }) =>
      apiFetch<OptionView>(
        `${optionsPath(tripId, categoryId)}/${optionId}/lock`,
        { method: "POST", body },
      ),
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, vars.categoryId),
      });
      void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) });
      void qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/*
 * `useBoardUnlock` lived here — a trip-scoped unlock whose category was only
 * known at drop time, for dragging a chip out of the Decided rail. The rail is
 * gone and with it the only caller: unlocking now happens from a settled card's
 * "⋯" menu, inside a lane that already knows its category, which is what
 * `useUnlockOption` is for. Removed rather than kept warm — an exported hook
 * nothing calls reads as a supported entry point.
 */

/** Reorder a lane's options by dragging a card within it (Organizers). */
export function useBoardReorderOptions(
  tripId: string,
): UseMutationResult<
  OptionView[],
  ApiError,
  { categoryId: string; orderedIds: string[] }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, orderedIds }) =>
      apiFetch<OptionView[]>(`${optionsPath(tripId, categoryId)}/reorder`, {
        method: "POST",
        body: { orderedIds },
      }),
    onSuccess: (data, vars) => {
      qc.setQueryData(optionKeys.list(tripId, vars.categoryId), data);
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

/**
 * Toggle whether the caller is in for an `OPT_IN` option (post-launch).
 *
 * Deliberately the same shape as {@link useToggleVote}: POST to join, DELETE to
 * leave, both idempotent, both answering with the refreshed option. It takes the
 * card's current `viewerIsParticipant` so one hook drives the toggle.
 *
 * It invalidates the cost dashboard as well as the lane, because joining is not
 * an opinion — it changes what the option costs and how its total divides, so
 * the strip beside the lanes is stale the moment it lands.
 */
export function useToggleParticipation(
  tripId: string,
  categoryId: string,
): UseMutationResult<
  OptionView,
  ApiError,
  { optionId: string; isParticipant: boolean }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, isParticipant }) =>
      apiFetch<OptionView>(
        `${optionsPath(tripId, categoryId)}/${optionId}/participation`,
        { method: isParticipant ? "DELETE" : "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      });
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}
