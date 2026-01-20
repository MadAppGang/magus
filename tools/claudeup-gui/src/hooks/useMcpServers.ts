import { useTauriQuery, useTauriCommand } from "./useTauriCommand";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface McpServer {
  name: string;
  command: string;
  args?: string[];
  enabled: boolean;
  category?: string;
  description?: string;
}

export interface McpServerStatus {
  state: 'running' | 'stopped' | 'error' | 'unknown';
  error?: string;
}

export interface McpTestResult {
  success: boolean;
  error?: string;
  steps: Array<{ step: string; passed: boolean; error?: string }>;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface CuratedMcpServer {
  name: string;
  displayName: string;
  description: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  requiredEnv?: string[];
  category: string;
  docsUrl?: string;
}

// MCP Registry search types
export interface McpEnvironmentVariable {
  name: string;
  description?: string;
  isSecret?: boolean;
  format?: string;
}

export interface McpRegistryServer {
  name: string;
  url: string;
  short_description: string;
  version?: string;
  source_code_url?: string;
  package_registry?: string;
  published_at?: string;
  updated_at?: string;
  transport_type?: string;
  environment_variables?: McpEnvironmentVariable[];
  is_latest?: boolean;
  remote_url?: string;
  package_identifier?: string;
  repository_source?: string;
}

export interface McpRegistryResponse {
  servers: McpRegistryServer[];
  next_cursor?: string;
}

export interface SearchMcpRegistryParams {
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface AddMcpServerParams {
  name: string;
  config: McpServerConfig;
  projectPath: string;
}

export interface RemoveMcpServerParams {
  name: string;
  projectPath: string;
}

export interface ToggleMcpServerParams {
  name: string;
  enabled: boolean;
  projectPath: string;
}

export interface TestMcpConnectionParams {
  config: McpServerConfig;
}

export interface SetMcpEnvVarParams {
  serverName: string;
  key: string;
  value: string;
  projectPath: string;
}

export interface RemoveMcpEnvVarParams {
  serverName: string;
  key: string;
  projectPath: string;
}

export function useMcpServers(projectPath?: string) {
  return useTauriQuery<McpServer[]>(
    ["mcp-servers", projectPath || ""],
    "list_mcp_servers",
    projectPath ? { projectPath } : undefined,
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: true,
      enabled: !!projectPath,
    }
  );
}

export function useAddMcpServer() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, AddMcpServerParams>(
    "add_mcp_server",
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["mcp-servers", variables.projectPath],
        });
      },
    }
  );
}

export function useRemoveMcpServer() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, RemoveMcpServerParams>(
    "remove_mcp_server",
    {
      onMutate: async (variables) => {
        await queryClient.cancelQueries({
          queryKey: ["mcp-servers", variables.projectPath],
        });

        const previousServers = queryClient.getQueryData<McpServer[]>([
          "mcp-servers",
          variables.projectPath,
        ]);

        queryClient.setQueryData<McpServer[]>(
          ["mcp-servers", variables.projectPath],
          (old) => old?.filter((server) => server.name !== variables.name)
        );

        return { previousServers };
      },
      onError: (_error, variables, context) => {
        const ctx = context as { previousServers?: McpServer[] } | undefined;
        if (ctx?.previousServers) {
          queryClient.setQueryData(
            ["mcp-servers", variables.projectPath],
            ctx.previousServers
          );
        }
      },
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["mcp-servers", variables.projectPath],
        });
      },
    }
  );
}

export function useToggleMcpServer() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, ToggleMcpServerParams>(
    "toggle_mcp_server",
    {
      onMutate: async (variables) => {
        await queryClient.cancelQueries({
          queryKey: ["mcp-servers", variables.projectPath],
        });

        const previousServers = queryClient.getQueryData<McpServer[]>([
          "mcp-servers",
          variables.projectPath,
        ]);

        queryClient.setQueryData<McpServer[]>(
          ["mcp-servers", variables.projectPath],
          (old) =>
            old?.map((server) =>
              server.name === variables.name
                ? { ...server, enabled: variables.enabled }
                : server
            )
        );

        return { previousServers };
      },
      onError: (_error, variables, context) => {
        const ctx = context as { previousServers?: McpServer[] } | undefined;
        if (ctx?.previousServers) {
          queryClient.setQueryData(
            ["mcp-servers", variables.projectPath],
            ctx.previousServers
          );
        }
      },
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["mcp-servers", variables.projectPath],
        });
      },
    }
  );
}

export function useTestMcpConnection() {
  return useTauriCommand<McpTestResult, TestMcpConnectionParams>(
    "test_mcp_connection"
  );
}

export function useMcpServerStatus(serverName?: string, projectPath?: string) {
  return useTauriQuery<McpServerStatus>(
    ["mcp-server-status", serverName || "", projectPath || ""],
    "get_mcp_server_status",
    serverName && projectPath ? { serverName, projectPath } : undefined,
    {
      staleTime: 30 * 1000, // 30 seconds
      refetchInterval: 30 * 1000, // Refetch every 30 seconds
      enabled: !!serverName && !!projectPath,
    }
  );
}

export function useMcpEnvVars(serverName?: string, projectPath?: string) {
  return useTauriQuery<Record<string, string>>(
    ["mcp-env-vars", serverName || "", projectPath || ""],
    "get_mcp_env_vars",
    serverName && projectPath ? { serverName, projectPath } : undefined,
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      enabled: !!serverName && !!projectPath,
    }
  );
}

export function useSetMcpEnvVar() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, SetMcpEnvVarParams>(
    "set_mcp_env_var",
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["mcp-env-vars", variables.serverName, variables.projectPath],
        });
      },
    }
  );
}

export function useRemoveMcpEnvVar() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, RemoveMcpEnvVarParams>(
    "remove_mcp_env_var",
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["mcp-env-vars", variables.serverName, variables.projectPath],
        });
      },
    }
  );
}

export function useCuratedMcpServers() {
  return useTauriQuery<CuratedMcpServer[]>(
    ["curated-mcp-servers"],
    "get_curated_mcp_servers",
    undefined,
    {
      staleTime: Infinity, // Static data
    }
  );
}

// Hook to fetch env vars for multiple servers at once
export function useAllMcpEnvVars(serverNames: string[], projectPath?: string) {
  const results = useQueries({
    queries: serverNames.map(serverName => ({
      queryKey: ["mcp-env-vars", serverName, projectPath || ""],
      queryFn: async () => {
        if (!projectPath) return {};
        const result = await invoke<Record<string, string>>("get_mcp_env_vars", {
          serverName,
          projectPath,
        });
        // Handle potentially wrapped response
        if (result && typeof result === 'object' && 'envVars' in result) {
          return (result as unknown as { envVars: Record<string, string> }).envVars || {};
        }
        return result || {};
      },
      staleTime: 5 * 60 * 1000,
      enabled: !!projectPath,
    })),
  });

  // Return a map of serverName -> envVars
  const envVarsMap: Record<string, Record<string, string>> = {};
  serverNames.forEach((name, index) => {
    envVarsMap[name] = results[index]?.data || {};
  });

  return {
    data: envVarsMap,
    isLoading: results.some(r => r.isLoading),
  };
}

// Hook to search MCP registry online
export function useSearchMcpRegistry(query: string, enabled = true) {
  return useTauriQuery<McpRegistryResponse>(
    ["mcp-registry-search", query],
    "search_mcp_registry",
    { query, limit: 50 },
    {
      staleTime: 60 * 1000, // 1 minute cache
      enabled: enabled && query.length >= 2, // Only search with 2+ chars
    }
  );
}
