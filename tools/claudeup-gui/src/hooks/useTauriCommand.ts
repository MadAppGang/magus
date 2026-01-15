import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, UseMutationOptions, UseQueryOptions } from "@tanstack/react-query";

interface TauriError {
  message: string;
  code?: string;
}

export function useTauriCommand<TData = unknown, TVariables = void>(
  commandName: string,
  options?: Omit<UseMutationOptions<TData, TauriError, TVariables>, "mutationFn">
) {
  return useMutation<TData, TauriError, TVariables>({
    mutationFn: async (variables) => {
      try {
        return await invoke<TData>(commandName, variables as Record<string, unknown>);
      } catch (error) {
        throw {
          message: error instanceof Error ? error.message : String(error),
          code: "TAURI_ERROR",
        } as TauriError;
      }
    },
    ...options,
  });
}

export function useTauriQuery<TData = unknown>(
  queryKey: string[],
  commandName: string,
  params?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<TData, TauriError>, "queryKey" | "queryFn">
) {
  return useQuery<TData, TauriError>({
    queryKey,
    queryFn: async () => {
      try {
        return await invoke<TData>(commandName, params);
      } catch (error) {
        throw {
          message: error instanceof Error ? error.message : String(error),
          code: "TAURI_ERROR",
        } as TauriError;
      }
    },
    ...options,
  });
}
