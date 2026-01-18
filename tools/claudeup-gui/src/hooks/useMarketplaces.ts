import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Marketplace source information
 */
export interface MarketplaceSource {
  source: 'github' | 'gitlab' | 'directory';
  repo?: string;
  url?: string;
}

/**
 * Marketplace information returned from backend
 */
export interface Marketplace {
  id: string;
  name: string;
  count: string;
  icon: string;
  isDefault?: boolean;
  source?: MarketplaceSource;
}

/**
 * Response from marketplace.list RPC call
 */
interface MarketplaceListResponse {
  marketplaces: Marketplace[];
}

/**
 * Response from marketplace.add RPC call
 */
interface AddMarketplaceResponse {
  success: boolean;
  name: string;
  displayName?: string;
}

/**
 * Response from marketplace.remove RPC call
 */
interface RemoveMarketplaceResponse {
  success: boolean;
  name: string;
}

/**
 * Hook to fetch all marketplaces
 */
export function useMarketplaces() {
  return useQuery<Marketplace[], Error>({
    queryKey: ["marketplaces"],
    queryFn: async () => {
      try {
        const response = await invoke<MarketplaceListResponse>("list_marketplaces");
        return response.marketplaces;
      } catch (error) {
        console.error("Failed to fetch marketplaces:", error);
        // Return empty array on error to prevent crash
        return [];
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to add a custom marketplace
 */
export function useAddMarketplace() {
  const queryClient = useQueryClient();

  return useMutation<AddMarketplaceResponse, Error, { url: string }>({
    mutationFn: async (params) => {
      const response = await invoke<AddMarketplaceResponse>("add_marketplace", {
        url: params.url,
      });
      return response;
    },
    onSuccess: async () => {
      // Small delay to ensure sidecar has finished writing files
      await new Promise(resolve => setTimeout(resolve, 100));
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["marketplaces"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
  });
}

/**
 * Hook to remove a custom marketplace
 */
export function useRemoveMarketplace() {
  const queryClient = useQueryClient();

  return useMutation<RemoveMarketplaceResponse, Error, { name: string }>({
    mutationFn: async (params) => {
      const response = await invoke<RemoveMarketplaceResponse>("remove_marketplace", {
        name: params.name,
      });
      return response;
    },
    onSuccess: async () => {
      // Small delay to ensure sidecar has finished writing files
      await new Promise(resolve => setTimeout(resolve, 100));
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["marketplaces"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
  });
}
