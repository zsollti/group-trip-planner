import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient factory so all three apps use the same fetching defaults.
 * Each app creates its own instance at startup and provides it via context.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
