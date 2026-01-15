import { useTauriQuery, useTauriCommand } from "./useTauriCommand";
import { useQueryClient } from "@tanstack/react-query";

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  scope: "global" | "project";
  marketplace: string;
}

export interface InstallPluginParams {
  name: string;
  scope: "global" | "project";
  marketplace?: string;
}

export interface TogglePluginParams {
  pluginId: string;
  enabled: boolean;
  scope: "global" | "project";
}

export function usePlugins(scope?: "global" | "project", projectPath?: string) {
  // Build params based on scope
  const params = scope === 'project'
    ? { scope, projectPath }
    : scope === 'global'
    ? { scope }
    : undefined;

  return useTauriQuery<Plugin[]>(
    ["plugins", scope || "all", projectPath || ""],
    "list_plugins",
    params,
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: true,
      // Only enable project query if we have a projectPath
      enabled: scope !== 'project' || !!projectPath,
    }
  );
}

export function useInstallPlugin() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, InstallPluginParams>(
    "install_plugin",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["plugins"] });
      },
    }
  );
}

export function useEnablePlugin() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, TogglePluginParams>(
    "enable_plugin",
    {
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: ["plugins"] });

        const previousPlugins = queryClient.getQueryData<Plugin[]>(["plugins", variables.scope]);

        queryClient.setQueryData<Plugin[]>(["plugins", variables.scope], (old) =>
          old?.map((plugin) =>
            plugin.id === variables.pluginId
              ? { ...plugin, enabled: variables.enabled }
              : plugin
          )
        );

        return { previousPlugins } as { previousPlugins: Plugin[] | undefined };
      },
      onError: (_error, variables, context) => {
        const ctx = context as { previousPlugins?: Plugin[] } | undefined;
        if (ctx?.previousPlugins) {
          queryClient.setQueryData(["plugins", variables.scope], ctx.previousPlugins);
        }
      },
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({ queryKey: ["plugins", variables.scope] });
      },
    }
  );
}

export function useDisablePlugin() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, TogglePluginParams>(
    "disable_plugin",
    {
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: ["plugins"] });

        const previousPlugins = queryClient.getQueryData<Plugin[]>(["plugins", variables.scope]);

        queryClient.setQueryData<Plugin[]>(["plugins", variables.scope], (old) =>
          old?.map((plugin) =>
            plugin.id === variables.pluginId
              ? { ...plugin, enabled: variables.enabled }
              : plugin
          )
        );

        return { previousPlugins } as { previousPlugins: Plugin[] | undefined };
      },
      onError: (_error, variables, context) => {
        const ctx = context as { previousPlugins?: Plugin[] } | undefined;
        if (ctx?.previousPlugins) {
          queryClient.setQueryData(["plugins", variables.scope], ctx.previousPlugins);
        }
      },
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({ queryKey: ["plugins", variables.scope] });
      },
    }
  );
}

export function useRefreshMarketplaces() {
  const queryClient = useQueryClient();

  return useTauriCommand<{ success: boolean }, void>(
    "refresh_marketplaces",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["plugins"] });
      },
    }
  );
}
