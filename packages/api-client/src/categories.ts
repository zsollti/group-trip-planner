import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CategoryView,
  CreateCategoryInput,
  RenameCategoryInput,
  ReorderCategoriesInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for a trip's categories, so invalidation stays consistent. */
export const categoryKeys = {
  all: ["categories"] as const,
  list: (tripId: string) => [...categoryKeys.all, "list", tripId] as const,
};

/** The trip's categories in display order (any member). */
export function useTripCategories(
  tripId: string | undefined,
): UseQueryResult<CategoryView[], ApiError> {
  return useQuery({
    queryKey: categoryKeys.list(tripId ?? ""),
    queryFn: () => apiFetch<CategoryView[]>(`/trips/${tripId}/categories`),
    enabled: Boolean(tripId),
  });
}

/** Create a custom category (Organizers); refreshes the category list. */
export function useCreateCategory(
  tripId: string,
): UseMutationResult<CategoryView, ApiError, CreateCategoryInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<CategoryView>(`/trips/${tripId}/categories`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) }),
  });
}

/**
 * Rename a category (Organizers). The caller passes the `version` they last saw;
 * a 409 {@link ApiError} means it changed underneath them and the UI should
 * prompt a reload.
 */
export function useRenameCategory(
  tripId: string,
): UseMutationResult<
  CategoryView,
  ApiError,
  { categoryId: string } & RenameCategoryInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, name, version }) =>
      apiFetch<CategoryView>(`/trips/${tripId}/categories/${categoryId}`, {
        method: "PATCH",
        body: { name, version },
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) }),
  });
}

/** Delete a category (Organizers) — hard cascade. Refreshes the category list. */
export function useDeleteCategory(
  tripId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      apiFetch<void>(`/trips/${tripId}/categories/${categoryId}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) }),
  });
}

/** Reorder all of the trip's categories (Organizers). */
export function useReorderCategories(
  tripId: string,
): UseMutationResult<CategoryView[], ApiError, ReorderCategoriesInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReorderCategoriesInput) =>
      apiFetch<CategoryView[]>(`/trips/${tripId}/categories/reorder`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (categories) => {
      qc.setQueryData(categoryKeys.list(tripId), categories);
    },
  });
}
