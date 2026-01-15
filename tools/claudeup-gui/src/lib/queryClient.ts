import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

// Configure cache size bounds to prevent memory issues
// TanStack Query v5 uses gcTime for cache management
// Additional manual bounds:
const MAX_CACHE_SIZE = 100;

// Monitor cache size and prune if needed
setInterval(() => {
  const cache = queryClient.getQueryCache();
  const queries = cache.getAll();

  if (queries.length > MAX_CACHE_SIZE) {
    // Remove oldest stale queries
    const staleQueries = queries
      .filter((query) => query.state.dataUpdatedAt > 0)
      .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)
      .slice(0, queries.length - MAX_CACHE_SIZE);

    staleQueries.forEach((query) => {
      cache.remove(query);
    });
  }
}, 60000); // Check every minute
