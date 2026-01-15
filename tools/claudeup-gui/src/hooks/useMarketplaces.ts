import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Marketplace {
  id: string;
  name: string;
  url?: string;
  path?: string;
  count: string;
  icon: string;
  lastUpdated?: string;
}

// Default marketplaces - in a real implementation, these would come from settings
const DEFAULT_MARKETPLACES: Marketplace[] = [
  {
    id: 'claude-plugins-official',
    name: 'Claude Official',
    url: 'https://github.com/anthropics/claude-plugins-official',
    count: '40+ plugins',
    icon: 'package',
  },
  {
    id: 'mag-claude-plugins',
    name: 'MAG Claude Plugins',
    url: 'https://github.com/MadAppGang/claude-code',
    count: '8 plugins',
    icon: 'package',
  },
  {
    id: 'local',
    name: 'Local Plugins',
    path: '~/.claude/plugins',
    count: '0 plugins',
    icon: 'folder',
  },
];

export function useMarketplaces() {
  // For now, return static marketplaces
  // TODO: Load from settings when backend supports it
  return useQuery<Marketplace[]>({
    queryKey: ["marketplaces"],
    queryFn: async () => DEFAULT_MARKETPLACES,
    staleTime: Infinity, // Static data, never stale
  });
}

export function useAddMarketplace() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, { url: string; name?: string }>({
    mutationFn: async (_params) => {
      // TODO: Implement when backend supports it
      console.warn('Add marketplace not implemented yet');
      return { success: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplaces"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
  });
}

export function useRemoveMarketplace() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, { id: string }>({
    mutationFn: async (_params) => {
      // TODO: Implement when backend supports it
      console.warn('Remove marketplace not implemented yet');
      return { success: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplaces"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
  });
}
