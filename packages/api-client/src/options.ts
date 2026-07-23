import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateOptionInput,
  OptionView,
  UpdateOptionInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

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
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      }),
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
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      }),
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
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: optionKeys.list(tripId, categoryId),
      }),
  });
}
