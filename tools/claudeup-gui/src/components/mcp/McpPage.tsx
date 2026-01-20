import React, { useState, useMemo, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useMcpServers, useCuratedMcpServers, useAllMcpEnvVars, useSearchMcpRegistry, McpServer, CuratedMcpServer, McpRegistryServer } from '../../hooks/useMcpServers';
import McpServerList from './McpServerList';
import McpServerDetail from './McpServerDetail';
import AddMcpServerModal from './AddMcpServerModal';
import { LoadingSpinner } from '../LoadingSpinner';
import { ErrorDisplay } from '../ErrorDisplay';

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

interface McpPageProps {
  projectPath?: string;
}

const McpPage: React.FC<McpPageProps> = ({ projectPath }) => {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: serversData, isLoading: serversLoading, error: serversError, refetch: refetchServers } = useMcpServers(projectPath);
  const { data: curatedData } = useCuratedMcpServers();

  // Debounce search query for online search (300ms delay)
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Search online registry when search query is 2+ characters
  const { data: registryData, isLoading: isSearching } = useSearchMcpRegistry(
    debouncedSearchQuery,
    debouncedSearchQuery.length >= 2
  );

  // Extract arrays from potentially wrapped responses
  const servers = useMemo(() => {
    if (!serversData) return [];
    if (Array.isArray(serversData)) return serversData;
    if (typeof serversData === 'object' && 'servers' in serversData) {
      return (serversData as { servers: McpServer[] }).servers || [];
    }
    return [];
  }, [serversData]);

  const curatedServers = useMemo(() => {
    if (!curatedData) return [];
    if (Array.isArray(curatedData)) return curatedData;
    if (typeof curatedData === 'object' && 'servers' in curatedData) {
      return (curatedData as { servers: CuratedMcpServer[] }).servers || [];
    }
    return [];
  }, [curatedData]);

  // Get server names for fetching env vars
  const installedServerNames = useMemo(() => servers.map(s => s.name), [servers]);

  // Fetch env vars for all installed servers
  const { data: allEnvVars } = useAllMcpEnvVars(installedServerNames, projectPath);

  // Extract registry servers from search results
  const registryServers = useMemo(() => {
    if (!registryData?.servers) return [];
    // Handle potentially wrapped response
    const servers = Array.isArray(registryData.servers)
      ? registryData.servers
      : (registryData as any).servers?.servers || [];
    return servers;
  }, [registryData]);

  // Create a unified list of installed + available curated servers + registry servers
  const allServers = useMemo(() => {
    const installedNames = new Set(servers.map(s => s.name));
    const curatedNames = new Set(curatedServers.map(c => c.name));

    // Start with installed servers (enriched with curated data)
    const installed = servers.map(server => {
      const curated = curatedServers.find(c => c.name === server.name);
      const requiredEnv = curated?.requiredEnv || [];
      const configuredEnv = allEnvVars[server.name] || {};
      const configuredKeys = Object.keys(configuredEnv);

      // Find missing required env vars
      const missingEnvVars = requiredEnv.filter(
        envKey => !configuredKeys.includes(envKey) || !configuredEnv[envKey]
      );

      return {
        ...server,
        description: server.description || curated?.description,
        category: server.category || curated?.category,
        isInstalled: true,
        requiredEnv,
        missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
        curatedConfig: curated,
      };
    });

    // Add curated servers that aren't installed yet
    const available = curatedServers
      .filter(c => !installedNames.has(c.name))
      .map(curated => ({
        name: curated.name,
        command: curated.command,
        args: curated.args,
        enabled: false,
        description: curated.description,
        category: curated.category,
        isInstalled: false,
        requiredEnv: curated.requiredEnv,
        curatedConfig: curated, // Keep full config for installation
      }));

    // Add registry servers that aren't installed or in curated list
    const fromRegistry = registryServers
      .filter((r: McpRegistryServer) => !installedNames.has(r.name) && !curatedNames.has(r.name))
      .map((registry: McpRegistryServer) => ({
        name: registry.name,
        command: registry.url.startsWith('npm:') ? 'npx' : undefined,
        args: registry.url.startsWith('npm:')
          ? ['-y', registry.url.replace('npm:', '')]
          : undefined,
        enabled: false,
        description: registry.short_description,
        category: 'other' as const,
        isInstalled: false,
        isFromRegistry: true,
        registryUrl: registry.url,
        version: registry.version,
        sourceCodeUrl: registry.source_code_url,
        packageRegistry: registry.package_registry,
        publishedAt: registry.published_at,
        updatedAt: registry.updated_at,
        transportType: registry.transport_type,
        registryEnvVars: registry.environment_variables,
        isLatest: registry.is_latest,
        remoteUrl: registry.remote_url,
        packageIdentifier: registry.package_identifier,
        repositorySource: registry.repository_source,
      }));

    return [...installed, ...available, ...fromRegistry];
  }, [servers, curatedServers, allEnvVars, registryServers]);

  // Filter servers
  const filteredServers = useMemo(() => {
    let result = allServers;

    // Category filter
    if (categoryFilter !== 'all') {
      result = result.filter(s => s.category === categoryFilter);
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.command?.toLowerCase().includes(q)
      );
    }

    // Sort: installed first, then by name
    result.sort((a, b) => {
      if (a.isInstalled !== b.isInstalled) {
        return a.isInstalled ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [allServers, categoryFilter, searchQuery]);

  const selectedServer = useMemo(() => {
    return filteredServers.find(s => s.name === selectedServerId);
  }, [filteredServers, selectedServerId]);

  // Auto-select first server
  React.useEffect(() => {
    if (!selectedServerId && filteredServers.length > 0) {
      setSelectedServerId(filteredServers[0].name);
    }
  }, [filteredServers, selectedServerId]);

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-textFaint">
        <p>No project selected</p>
      </div>
    );
  }

  if (serversLoading) {
    return <LoadingSpinner message="Loading MCP servers..." />;
  }

  if (serversError) {
    return (
      <ErrorDisplay
        message={`Failed to load MCP servers: ${serversError instanceof Error ? serversError.message : String(serversError)}`}
        onRetry={refetchServers}
      />
    );
  }

  return (
    <div className="flex flex-1 h-full bg-bgBase text-textMain font-sans overflow-hidden select-none">
      {/* LEFT COLUMN - Server List */}
      <div className="w-[380px] flex flex-col bg-bgBase border-r border-borderSubtle shrink-0">
        <McpServerList
          servers={filteredServers}
          selectedServerId={selectedServerId}
          searchQuery={searchQuery}
          categoryFilter={categoryFilter}
          isSearchingOnline={isSearching}
          onSelectServer={setSelectedServerId}
          onSearchChange={setSearchQuery}
          onCategoryChange={setCategoryFilter}
        />

        {/* Add Server Button */}
        <div className="p-3 border-t border-borderSubtle mt-auto">
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded border border-dashed border-borderSubtle text-textMuted hover:text-textMain hover:bg-white/5 hover:border-textFaint transition-all text-[12px]"
          >
            <Plus size={14} />
            <span>Add MCP Server</span>
          </button>
        </div>
      </div>

      {/* RIGHT COLUMN - Server Detail */}
      <main className="flex-1 flex flex-col bg-bgSidebar min-w-0 relative z-10">
        <McpServerDetail
          server={selectedServer}
          projectPath={projectPath}
        />
      </main>

      {/* Add Server Modal */}
      {showAddModal && (
        <AddMcpServerModal
          projectPath={projectPath}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default McpPage;
