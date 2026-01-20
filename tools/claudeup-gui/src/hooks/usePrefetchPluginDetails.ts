import { useEffect, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Plugin } from '../types';
import { PluginDetails } from './usePlugins';

/**
 * Hook to prefetch plugin details for URL-based plugins in the background.
 * Returns plugins with merged details as they become available.
 */
export function usePrefetchPluginDetails(plugins: Plugin[]): {
  enrichedPlugins: Plugin[];
  isFetching: boolean;
  fetchProgress: { done: number; total: number };
} {
  const queryClient = useQueryClient();
  const [enrichedPlugins, setEnrichedPlugins] = useState<Plugin[]>(plugins);
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0 });

  // Track which plugins we've already started fetching to avoid duplicate fetches
  const fetchedPluginsRef = useRef<Set<string>>(new Set());
  // Track the current plugins to detect actual changes
  const pluginIdsRef = useRef<string>('');

  // Identify URL-based plugins that need details fetched
  const getUrlBasedPlugins = useCallback((pluginList: Plugin[]) => {
    return pluginList.filter(plugin => {
      const hasNoComponents = !plugin.agents?.length && !plugin.commands?.length && !plugin.skills?.length;
      let sourceUrl: string | undefined;

      if (typeof plugin.source === 'string') {
        if (plugin.source.startsWith('http') || plugin.source.includes('github.com')) {
          sourceUrl = plugin.source;
        }
      } else if (plugin.source && typeof plugin.source === 'object' && plugin.source.url) {
        sourceUrl = plugin.source.url;
      }

      return hasNoComponents && !!sourceUrl;
    });
  }, []);

  // Extract URL from plugin source
  const getSourceUrl = (plugin: Plugin): string | undefined => {
    if (typeof plugin.source === 'string') {
      if (plugin.source.startsWith('http') || plugin.source.includes('github.com')) {
        return plugin.source;
      }
    } else if (plugin.source && typeof plugin.source === 'object' && plugin.source.url) {
      return plugin.source.url;
    }
    return undefined;
  };

  // Fetch details for a single plugin
  const fetchPluginDetails = useCallback(async (plugin: Plugin): Promise<PluginDetails | null> => {
    const sourceUrl = getSourceUrl(plugin);
    if (!sourceUrl) return null;

    // Check if already cached
    const cachedData = queryClient.getQueryData<PluginDetails>(['plugin-details', plugin.name, sourceUrl]);
    if (cachedData) return cachedData;

    try {
      const result = await invoke<PluginDetails>('fetch_plugin_details', {
        name: plugin.name,
        sourceUrl,
      });
      // Cache the result
      queryClient.setQueryData(['plugin-details', plugin.name, sourceUrl], result);
      return result;
    } catch (error) {
      console.error(`[Prefetch] Failed to fetch details for ${plugin.name}:`, error);
      return null;
    }
  }, [queryClient]);

  // Merge fetched details into plugin
  const mergeDetails = (plugin: Plugin, details: PluginDetails | null): Plugin => {
    if (!details) return plugin;
    return {
      ...plugin,
      agents: details.agents?.length ? details.agents : plugin.agents,
      commands: details.commands?.length ? details.commands : plugin.commands,
      skills: details.skills?.length ? details.skills : plugin.skills,
      mcpServers: details.mcpServers?.length ? details.mcpServers : plugin.mcpServers,
    };
  };

  useEffect(() => {
    // Detect project switch (plugins completely changed)
    const currentPluginIds = new Set(plugins.map(p => p.id));
    const previousIds = fetchedPluginsRef.current;
    const hasCommonPlugins = [...previousIds].some(id => currentPluginIds.has(id));

    // If no common plugins and we have new plugins, this is likely a project switch
    if (previousIds.size > 0 && plugins.length > 0 && !hasCommonPlugins) {
      console.log('[usePrefetchPluginDetails] Project switch detected, clearing cache');
      fetchedPluginsRef.current = new Set();
      pluginIdsRef.current = '';
    }

    // Create a stable key from plugin IDs and versions to detect actual changes
    const currentPluginKey = plugins.map(p => `${p.id}:${p.version}:${p.installedVersion || ''}`).sort().join(',');

    // Always update enrichedPlugins with latest base data first
    // This ensures version updates are reflected immediately
    const updatedPlugins = plugins.map(plugin => {
      // Check if we have cached details for this plugin
      const sourceUrl = getSourceUrl(plugin);
      if (sourceUrl) {
        const cachedData = queryClient.getQueryData<PluginDetails>(['plugin-details', plugin.name, sourceUrl]);
        if (cachedData) {
          return mergeDetails(plugin, cachedData);
        }
      }
      return plugin;
    });
    setEnrichedPlugins(updatedPlugins);

    // Skip further processing if plugins haven't actually changed
    if (currentPluginKey === pluginIdsRef.current) {
      return;
    }
    pluginIdsRef.current = currentPluginKey;

    const urlBasedPlugins = getUrlBasedPlugins(plugins);

    // Filter out plugins we've already fetched
    const pluginsToFetch = urlBasedPlugins.filter(p => !fetchedPluginsRef.current.has(p.id));

    if (pluginsToFetch.length === 0) {
      setFetchProgress({ done: 0, total: 0 });
      return;
    }

    setFetchProgress({ done: 0, total: pluginsToFetch.length });

    // Start with updated plugins (with cached details merged)
    let currentPlugins = [...updatedPlugins];

    // Mark plugins as being fetched
    pluginsToFetch.forEach(p => fetchedPluginsRef.current.add(p.id));

    // Fetch details for each URL-based plugin in parallel (with concurrency limit)
    const fetchAll = async () => {
      const CONCURRENCY = 3; // Fetch 3 at a time
      let completed = 0;

      for (let i = 0; i < pluginsToFetch.length; i += CONCURRENCY) {
        const batch = pluginsToFetch.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(fetchPluginDetails));

        // Update plugins with fetched details
        currentPlugins = currentPlugins.map(plugin => {
          const batchIndex = batch.findIndex(p => p.id === plugin.id);
          if (batchIndex >= 0 && results[batchIndex]) {
            return mergeDetails(plugin, results[batchIndex]);
          }
          return plugin;
        });

        completed += batch.length;
        setFetchProgress({ done: completed, total: pluginsToFetch.length });
        setEnrichedPlugins([...currentPlugins]);
      }
    };

    fetchAll();
  }, [plugins, getUrlBasedPlugins, fetchPluginDetails]);

  return {
    enrichedPlugins,
    isFetching: fetchProgress.total > 0 && fetchProgress.done < fetchProgress.total,
    fetchProgress,
  };
}
