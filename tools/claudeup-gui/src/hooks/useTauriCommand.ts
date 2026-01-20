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

// Timeout wrapper for invoke calls
async function invokeWithTimeout<T>(commandName: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
  const startTime = Date.now();
  console.log(`[invokeWithTimeout] Starting ${commandName} at ${startTime}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Invoke timeout after ${timeoutMs}ms for command: ${commandName}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      invoke<T>(commandName, params),
      timeoutPromise
    ]);
    const duration = Date.now() - startTime;
    console.log(`[invokeWithTimeout] ${commandName} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[invokeWithTimeout] ${commandName} failed after ${duration}ms:`, error);
    throw error;
  }
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
      console.log(`[useTauriQuery] Invoking ${commandName}`, { queryKey, params });
      try {
        const result = await invokeWithTimeout<TData>(commandName, params);
        console.log(`[useTauriQuery] ${commandName} result:`, Array.isArray(result) ? `${result.length} items` : typeof result);
        return result;
      } catch (error) {
        console.error(`[useTauriQuery] ${commandName} error:`, error);
        throw {
          message: error instanceof Error ? error.message : String(error),
          code: "TAURI_ERROR",
        } as TauriError;
      }
    },
    ...options,
  });
}
