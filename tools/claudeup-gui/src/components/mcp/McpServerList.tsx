import React from 'react';
import { Search, Loader2 } from 'lucide-react';
import McpServerCard from './McpServerCard';

// Extended server type that includes installation status
interface ExtendedMcpServer {
  name: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  category?: string;
  description?: string;
  isInstalled?: boolean;
  requiredEnv?: string[];
  missingEnvVars?: string[];
  isFromRegistry?: boolean;
  version?: string;
  sourceCodeUrl?: string;
  packageRegistry?: string;
  publishedAt?: string;
}

interface McpServerListProps {
  servers: ExtendedMcpServer[];
  selectedServerId: string | null;
  searchQuery: string;
  categoryFilter: string;
  isSearchingOnline?: boolean;
  onSelectServer: (name: string) => void;
  onSearchChange: (query: string) => void;
  onCategoryChange: (category: string) => void;
}

const categories = [
  { id: 'all', label: 'All' },
  { id: 'filesystem', label: 'Filesystem' },
  { id: 'database', label: 'Database' },
  { id: 'api', label: 'API' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'development', label: 'Development' },
  { id: 'other', label: 'Other' },
];

const McpServerList: React.FC<McpServerListProps> = ({
  servers,
  selectedServerId,
  searchQuery,
  categoryFilter,
  isSearchingOnline,
  onSelectServer,
  onSearchChange,
  onCategoryChange,
}) => {
  // Split servers into installed, curated available, and registry
  const installedServers = servers.filter(s => s.isInstalled !== false);
  const curatedServers = servers.filter(s => s.isInstalled === false && !s.isFromRegistry);
  const registryServers = servers.filter(s => s.isInstalled === false && s.isFromRegistry);

  return (
    <>
      {/* Search Header */}
      <div className="h-14 flex items-center px-4 shrink-0 border-b border-borderSubtle">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textFaint" size={15} />
          <input
            type="text"
            placeholder="Search MCP servers..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-bgSidebar border border-borderSubtle rounded-[4px] pl-9 pr-3 py-1.5 text-[13px] text-textMain placeholder:text-textFaint focus:outline-none focus:border-borderFocus transition-colors"
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="px-4 py-3 border-b border-borderSubtle">
        <div className="flex flex-wrap gap-1.5">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => onCategoryChange(cat.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-accent text-white'
                  : 'bg-bgSurface text-textMuted hover:text-textMain hover:bg-white/5 border border-borderSubtle'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Server List */}
      <div className="flex-1 overflow-y-auto">
        {/* Installed Section */}
        {installedServers.length > 0 && (
          <>
            <div className="px-4 py-2 text-[10px] font-semibold text-textFaint uppercase tracking-wider bg-bgBase/50 border-b border-borderSubtle sticky top-0">
              Installed ({installedServers.length})
            </div>
            {installedServers.map(server => (
              <McpServerCard
                key={server.name}
                server={server}
                selected={selectedServerId === server.name}
                onClick={() => onSelectServer(server.name)}
              />
            ))}
          </>
        )}

        {/* Curated Available Section */}
        {curatedServers.length > 0 && (
          <>
            <div className="px-4 py-2 text-[10px] font-semibold text-textFaint uppercase tracking-wider bg-bgBase/50 border-b border-borderSubtle sticky top-0">
              Available ({curatedServers.length})
            </div>
            {curatedServers.map(server => (
              <McpServerCard
                key={server.name}
                server={server}
                selected={selectedServerId === server.name}
                onClick={() => onSelectServer(server.name)}
              />
            ))}
          </>
        )}

        {/* Registry Search Results */}
        {(registryServers.length > 0 || isSearchingOnline) && (
          <>
            <div className="px-4 py-2 text-[10px] font-semibold text-textFaint uppercase tracking-wider bg-bgBase/50 border-b border-borderSubtle sticky top-0 flex items-center gap-2">
              <span>From Registry {registryServers.length > 0 && `(${registryServers.length})`}</span>
              {isSearchingOnline && <Loader2 size={10} className="animate-spin" />}
            </div>
            {registryServers.map(server => (
              <McpServerCard
                key={`registry-${server.name}`}
                server={server}
                selected={selectedServerId === server.name}
                onClick={() => onSelectServer(server.name)}
              />
            ))}
            {isSearchingOnline && registryServers.length === 0 && (
              <div className="px-4 py-6 text-center text-textFaint text-[11px]">
                Searching online registry...
              </div>
            )}
          </>
        )}

        {servers.length === 0 && !isSearchingOnline && (
          <div className="flex flex-col items-center justify-center h-40 text-textFaint">
            <span className="text-xs">No servers found</span>
          </div>
        )}
      </div>
    </>
  );
};

export default McpServerList;
