import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProjectStorage } from "../utils/projectStorage.js";
import { Project } from "../types.js";

// List all projects
export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => ProjectStorage.getProjects(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get current project
export function useCurrentProject() {
  return useQuery<Project | null>({
    queryKey: ["current-project"],
    queryFn: () => ProjectStorage.getCurrentProject(),
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Add new project
export function useAddProject() {
  const queryClient = useQueryClient();

  return useMutation<Project, Error, { path: string; name?: string }>({
    mutationFn: async ({ path, name }) => {
      const project = ProjectStorage.addProject(path, name);
      console.log('[useAddProject] Project added:', project);
      return project;
    },
    onSuccess: async (_project) => {
      console.log('[useAddProject] onSuccess, refetching queries...');
      // Force immediate refetch and wait for completion
      await queryClient.refetchQueries({ queryKey: ["current-project"] });
      await queryClient.refetchQueries({ queryKey: ["projects"] });
      // Remove old plugins queries - new queries will be created automatically
      queryClient.removeQueries({ queryKey: ["plugins"] });
      queryClient.removeQueries({ queryKey: ["plugin-details"] });
      console.log('[useAddProject] All queries refetched, plugins cleared for fresh fetch');
    },
  });
}

// Switch project
export function useSwitchProject() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { projectId: string }>({
    mutationFn: async ({ projectId }) => {
      ProjectStorage.setCurrentProject(projectId);
    },
    onSuccess: async () => {
      console.log('[useSwitchProject] onSuccess - starting cache updates');
      // Clear plugin detail caches (they're project-independent but we want fresh data)
      queryClient.removeQueries({ queryKey: ["plugin-details"] });

      // IMPORTANT: Wait for current-project to refetch FIRST
      // This ensures the component re-renders with the new project path
      // before any plugins queries are affected
      await queryClient.invalidateQueries({ queryKey: ["current-project"] });
      console.log('[useSwitchProject] current-project refetched');

      queryClient.invalidateQueries({ queryKey: ["projects"] });

      // Remove old plugins queries - new queries will be created automatically
      // when the component re-renders with the new project path
      queryClient.removeQueries({ queryKey: ["plugins"] });
      console.log('[useSwitchProject] plugins queries cleared, new queries will be created on re-render');
    },
  });
}

// Remove project
export function useRemoveProject() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { projectId: string }>({
    mutationFn: async ({ projectId }) => {
      ProjectStorage.removeProject(projectId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["current-project"] });
    },
  });
}

// Export old API for backwards compatibility
export function useRecentProjects() {
  return useProjects();
}

// Export type for backwards compatibility
export type { Project };
