import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: string;
}

// Convert path to Project object
function pathToProject(path: string): Project {
  const parts = path.split('/');
  const name = parts[parts.length - 1] || 'Unknown';
  return {
    id: path, // Use path as ID
    name,
    path,
    lastOpened: new Date().toISOString(),
  };
}

export function useProjects(_limit?: number) {
  // For now, return empty list - no backend support for project listing
  // TODO: Implement when backend supports it
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => [],
    staleTime: Infinity,
  });
}

export function useCurrentProject() {
  return useQuery<Project | null>({
    queryKey: ["current-project"],
    queryFn: async () => {
      try {
        const path = await invoke<string | null>("get_current_project");
        if (path) {
          return pathToProject(path);
        }
        // If no project set, try to use current working directory
        return null;
      } catch (error) {
        console.warn('Failed to get current project:', error);
        return null;
      }
    },
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

export function useSwitchProject() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; path: string }, Error, { path: string }>({
    mutationFn: async ({ path }) => {
      try {
        await invoke("set_current_project", { path });
        return { success: true, path };
      } catch (error) {
        console.error('Failed to switch project:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["current-project"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
  });
}

export function useRecentProjects() {
  return useProjects(10);
}
