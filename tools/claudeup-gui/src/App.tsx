import React, { useState, useMemo, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Search, Package, Globe, Activity, Layout, Store,
  HelpCircle, ChevronDown, FolderOpen, Plus, Trash2, Folder, History, Check, X, Server
} from 'lucide-react';
import { Plugin, AppState } from './types';
import PluginRow from './components/plugins/PluginRow';
import RightSidebar from './components/plugins/RightSidebar';
import McpPage from './components/mcp/McpPage';
import { usePlugins } from './hooks/usePlugins';
import { usePrefetchPluginDetails } from './hooks/usePrefetchPluginDetails';
import { adaptPluginsFromBackend } from './utils/pluginAdapter';
import { useMarketplaces, useAddMarketplace, useRemoveMarketplace, Marketplace } from './hooks/useMarketplaces';
import { useProjects, useCurrentProject, useSwitchProject, useAddProject, useRemoveProject, Project } from './hooks/useProjects';
import { useProjectDialog } from './hooks/useProjectDialog';
import { ToastProvider, useToast, ToastContainer } from './components/Toast';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorDisplay } from './components/ErrorDisplay';
import { WelcomeScreen } from './components/WelcomeScreen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const AppContent: React.FC = () => {
  const toast = useToast();

  // --- Backend Data ---
  // Fetch current project first to get the path
  const { data: currentProject, isLoading: currentProjectLoading } = useCurrentProject();

  // Fetch plugins for project scope (backend returns all scope data for each plugin)
  const { data: projectPlugins, isLoading: projectLoading, error: projectError, refetch: refetchProject } = usePlugins('project', currentProject?.path);

  // Transform backend data - no merging needed, just use project plugins
  const backendPlugins = useMemo(() => {
    console.log('[App] projectPlugins raw:', projectPlugins);
    // Safely extract arrays from potentially wrapped responses
    const toArray = <T,>(data: T[] | { plugins?: T[]; data?: T[] } | undefined | null): T[] => {
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (typeof data === 'object') {
        if ('plugins' in data && Array.isArray(data.plugins)) return data.plugins;
        if ('data' in data && Array.isArray(data.data)) return data.data;
      }
      return [];
    };

    const result = toArray(projectPlugins);
    console.log('[App] backendPlugins extracted:', result.length, 'plugins');
    return result;
  }, [projectPlugins]);

  const pluginsLoading = projectLoading;
  const pluginsError = projectError;
  const refetchPlugins = () => {
    refetchProject();
  };
  const { data: marketplacesData, isLoading: marketplacesLoading, error: marketplacesError, refetch: refetchMarketplaces } = useMarketplaces();
  const { data: projectsData, isLoading: projectsLoading, error: projectsError, refetch: refetchProjects } = useProjects();

  const addMarketplaceMutation = useAddMarketplace();
  const removeMarketplaceMutation = useRemoveMarketplace();
  const switchProjectMutation = useSwitchProject();
  const addProjectMutation = useAddProject();
  const removeProjectMutation = useRemoveProject();
  const { selectProjectFolder } = useProjectDialog();

  // Transform backend data to frontend format
  const transformedPlugins = useMemo(() => {
    if (!backendPlugins || backendPlugins.length === 0) {
      console.log('[App] transformedPlugins: empty (no backendPlugins)');
      return [];
    }
    const result = adaptPluginsFromBackend(backendPlugins);
    console.log('[App] transformedPlugins:', result.length, 'plugins');
    return result;
  }, [backendPlugins]);

  // Prefetch details for URL-based plugins in background
  const { enrichedPlugins: plugins } = usePrefetchPluginDetails(transformedPlugins);
  console.log('[App] enrichedPlugins:', plugins.length, 'plugins');

  const marketplaces: Marketplace[] = Array.isArray(marketplacesData) ? marketplacesData : [];
  const projects: Project[] = Array.isArray(projectsData) ? projectsData : [];

  // --- State ---
  const [currentScreen, setCurrentScreen] = useState<'plugins' | 'mcp'>('plugins');
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [showAddMarketplaceModal, setShowAddMarketplaceModal] = useState(false);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [isAddingMarketplace, setIsAddingMarketplace] = useState(false);

  const [state, setState] = useState<AppState>({
    activeMarketplace: marketplaces[0]?.id || '',
    activeProjectId: currentProject?.id || '',
    searchQuery: '',
    selectedPluginId: null
  });

  // Update active marketplace when data loads
  useEffect(() => {
    if (marketplaces.length > 0 && !state.activeMarketplace) {
      setState(prev => ({ ...prev, activeMarketplace: marketplaces[0].id }));
    }
  }, [marketplaces, state.activeMarketplace]);

  // Update active project when current project loads
  useEffect(() => {
    if (currentProject && currentProject.id !== state.activeProjectId) {
      setState(prev => ({ ...prev, activeProjectId: currentProject.id }));
    }
  }, [currentProject, state.activeProjectId]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Default selection
  useEffect(() => {
    if (!state.selectedPluginId && filteredPlugins.length > 0) {
      setState(prev => ({ ...prev, selectedPluginId: filteredPlugins[0].id }));
    }
  }, [state.activeMarketplace]);

  // --- Handlers ---

  // Handle updates from the Detail View (Scope toggles, installs, etc.)
  // Note: Updates now handled by TanStack Query invalidation
  const handlePluginUpdate = (_updatedPlugin: Plugin) => {
    // No-op: Backend mutations auto-refresh via query invalidation
    // Keeping this for interface compatibility
  };

  // Marketplace Management
  const handleAddMarketplace = async () => {
    if (!marketplaceUrl.trim()) return;

    setIsAddingMarketplace(true);
    try {
      await addMarketplaceMutation.mutateAsync({ url: marketplaceUrl.trim() });
      toast.addToast('Marketplace added successfully', 'success');
      setShowAddMarketplaceModal(false);
      setMarketplaceUrl('');
    } catch (error) {
      toast.addToast(
        `Failed to add marketplace: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      setIsAddingMarketplace(false);
    }
  };

  const openAddMarketplaceModal = () => {
    setMarketplaceUrl('');
    setShowAddMarketplaceModal(true);
  };

  const handleRemoveMarketplace = async (e: React.MouseEvent, mp: { id: string; name: string }) => {
    e.stopPropagation();
    if (!window.confirm("Remove this marketplace?")) return;

    try {
      await removeMarketplaceMutation.mutateAsync({ name: mp.name });
      toast.addToast('Marketplace removed successfully', 'success');

      if (state.activeMarketplace === mp.id && marketplaces.length > 0) {
        setState(prev => ({ ...prev, activeMarketplace: marketplaces[0].id }));
      }
    } catch (error) {
      toast.addToast(
        `Failed to remove marketplace: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleAddProject = async () => {
    console.log('[handleAddProject] Starting folder selection...');
    const path = await selectProjectFolder();
    console.log('[handleAddProject] Selected path:', path);
    if (!path) {
      console.log('[handleAddProject] User cancelled');
      return;
    }

    try {
      console.log('[handleAddProject] Adding project with path:', path);
      const result = await addProjectMutation.mutateAsync({ path });
      console.log('[handleAddProject] Mutation result:', result);
      toast.addToast('Project added successfully', 'success');
    } catch (error) {
      console.error('[handleAddProject] Error:', error);
      toast.addToast(
        `Failed to add project: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleSwitchProject = async (projectId: string) => {
    try {
      await switchProjectMutation.mutateAsync({ projectId });
      setIsProjectMenuOpen(false);
    } catch (error) {
      toast.addToast(
        `Failed to switch project: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleRemoveProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!window.confirm("Remove this project?")) return;

    try {
      await removeProjectMutation.mutateAsync({ projectId });
      toast.addToast('Project removed successfully', 'success');
    } catch (error) {
      toast.addToast(
        `Failed to remove project: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  // --- Derived ---
  const activeProject = currentProject || projects.find(p => p.id === state.activeProjectId) || projects[0];

  const filteredPlugins = useMemo(() => {
    let result = plugins;

    // Filter by marketplace
    if (state.activeMarketplace) {
       result = result.filter(p => p.marketplace === state.activeMarketplace);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.keywords?.some(k => k.toLowerCase().includes(q))
      );
    }
    return result;
  }, [plugins, state.activeMarketplace, state.searchQuery]);

  const selectedPlugin = useMemo(() => plugins.find(p => p.id === state.selectedPluginId), [plugins, state.selectedPluginId]);

  const getMarketplaceUpdateCount = (marketplaceId: string) => {
    // Count plugins in this marketplace that have updates
    return plugins.filter(p => p.marketplace === marketplaceId && p.hasUpdate).length;
  };

  const getMarketplacePluginCount = (marketplaceId: string) => {
    // Count total plugins in this marketplace
    const count = plugins.filter(p => p.marketplace === marketplaceId).length;
    return `${count} plugin${count !== 1 ? 's' : ''}`;
  };

  // Loading state - only show spinner on initial load, not during project switches
  const isInitialLoading = (currentProjectLoading && !currentProject) ||
                           (marketplacesLoading && !marketplacesData) ||
                           (projectsLoading && !projectsData);
  console.log('[App] Loading states:', { pluginsLoading, marketplacesLoading, projectsLoading, currentProjectLoading, isInitialLoading });
  console.log('[App] Data:', { currentProject, projectPlugins: projectPlugins?.length, marketplacesData: marketplacesData?.length, projectsData: projectsData?.length });
  if (isInitialLoading) {
    return <LoadingSpinner message="Loading data..." />;
  }

  // Show welcome screen if no project selected
  if (!currentProject) {
    return <WelcomeScreen onAddProject={handleAddProject} />;
  }

  // Helper to extract error message from various error types
  const getErrorMessage = (error: unknown): string => {
    if (!error) return 'Unknown error';
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      const err = error as Record<string, unknown>;
      if (err.message) return String(err.message);
      if (err.error) return String(err.error);
      try {
        return JSON.stringify(error);
      } catch {
        return 'Unknown error object';
      }
    }
    return String(error);
  };

  // Error state - show error if any critical data failed to load
  const hasError = pluginsError || marketplacesError || projectsError;
  if (hasError) {
    const errorMessage = pluginsError
      ? `Failed to load plugins: ${getErrorMessage(pluginsError)}`
      : marketplacesError
      ? `Failed to load marketplaces: ${getErrorMessage(marketplacesError)}`
      : `Failed to load projects: ${getErrorMessage(projectsError)}`;

    return (
      <ErrorDisplay
        message={errorMessage}
        onRetry={() => {
          refetchPlugins();
          refetchMarketplaces();
          refetchProjects();
        }}
      />
    );
  }

  // No data state
  if (plugins.length === 0 && marketplaces.length === 0) {
    return (
      <ErrorDisplay
        message="No plugins or marketplaces found. Add a marketplace to get started."
        onRetry={() => {
          refetchPlugins();
          refetchMarketplaces();
        }}
      />
    );
  }

  const getIcon = (name: string) => {
    switch (name) {
      case 'package': return <Package size={18} />;
      case 'chrome': return <Store size={18} />;
      case 'activity': return <Activity size={18} />;
      case 'globe': return <Globe size={18} />;
      case 'layout': return <Layout size={18} />;
      default: return <Package size={18} />;
    }
  }

  return (
    <div className="flex h-screen bg-bgBase text-textMain font-sans overflow-hidden select-none">

      {/* 1. LEFT SIDEBAR - PROJECT & MARKETPLACES */}
      <aside className="w-[240px] flex flex-col bg-bgBase border-r border-borderSubtle shrink-0">

        {/* Project Switcher Header */}
        <div ref={projectMenuRef} className="relative z-50">
          <button
            onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
            className="w-full h-14 flex items-center justify-between px-4 border-b border-borderSubtle hover:bg-white/[0.02] transition-colors text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-accent bg-accent/10 p-1.5 rounded-md shrink-0">
                <Folder size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-textMain truncate leading-tight">{activeProject?.name || 'No Project'}</span>
                <span className="text-[10px] text-textFaint truncate font-mono leading-tight opacity-70">
                  {activeProject?.path.split('/').pop() || '—'}
                </span>
              </div>
            </div>
            <ChevronDown size={14} className={`text-textFaint transition-transform duration-200 ${isProjectMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {isProjectMenuOpen && (
            <div className="absolute top-full left-2 right-2 mt-1 bg-bgSurface border border-borderSubtle rounded-lg shadow-float p-1 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100 origin-top">
              <div className="px-2 py-1.5 text-[10px] font-semibold text-textFaint uppercase tracking-wider">Recent Projects</div>

              {projects.map(proj => (
                <button
                  key={proj.id}
                  onClick={() => handleSwitchProject(proj.id)}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded text-left transition-colors group relative ${
                    proj.id === activeProject?.id ? 'bg-accent/10 text-textMain' : 'hover:bg-white/5 text-textMuted hover:text-textMain'
                  }`}
                >
                  <History size={13} className={proj.id === activeProject?.id ? 'text-accent' : 'text-textFaint'} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[12px] font-medium truncate">{proj.name}</span>
                    <span className="text-[10px] text-textFaint truncate">{proj.path}</span>
                  </div>
                  {proj.id === activeProject?.id && <Check size={12} className="text-accent" />}

                  {/* Delete Button */}
                  <div
                    onClick={(e) => handleRemoveProject(e, proj.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-red-500/20 text-textFaint hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all z-10"
                    title="Remove Project"
                  >
                    <Trash2 size={10} />
                  </div>
                </button>
              ))}

              <div className="h-px bg-borderSubtle my-1" />

              <button
                onClick={handleAddProject}
                className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-white/5 text-textMain text-left transition-colors"
              >
                <FolderOpen size={13} className="text-textFaint" />
                <span className="text-[12px] font-medium">Open Folder...</span>
              </button>
            </div>
          )}
        </div>

        {/* Screen Toggle - above Marketplaces */}
        <div className="px-2 py-2 border-b border-borderSubtle">
          <div className="flex rounded-lg bg-bgSurface p-1">
            <button
              onClick={() => setCurrentScreen('plugins')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium transition-all ${
                currentScreen === 'plugins'
                  ? 'bg-accent text-white'
                  : 'text-textMuted hover:text-textMain hover:bg-white/5'
              }`}
            >
              <Package size={14} />
              Plugins
            </button>
            <button
              onClick={() => setCurrentScreen('mcp')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium transition-all ${
                currentScreen === 'mcp'
                  ? 'bg-accent text-white'
                  : 'text-textMuted hover:text-textMain hover:bg-white/5'
              }`}
            >
              <Server size={14} />
              MCP
            </button>
          </div>
        </div>

        {/* Marketplace List */}
        {currentScreen === 'plugins' && (
        <div className="flex-1 py-2 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] font-semibold text-textFaint uppercase tracking-wider flex items-center justify-between">
            <span>Marketplaces</span>
          </div>

          {marketplaces.map(mp => {
            const updateCount = getMarketplaceUpdateCount(mp.id);
            const isActive = state.activeMarketplace === mp.id;

            return (
              <button
                key={mp.id}
                onClick={() => setState(prev => ({ ...prev, activeMarketplace: mp.id }))}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-all border-l-2 group relative ${
                  isActive
                    ? 'bg-white/[0.03] border-accent text-textMain'
                    : 'border-transparent text-textMuted hover:text-textMain hover:bg-white/[0.02]'
                }`}
              >
                <div className={`relative ${isActive ? 'text-accent' : 'text-textFaint'}`}>
                  {getIcon(mp.icon)}
                </div>
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <div className="w-full flex items-center justify-between">
                    <span className="text-[13px] font-medium leading-none mb-1 truncate">{mp.name}</span>
                    {updateCount > 0 && (
                      <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-accent text-[9px] font-bold text-white shadow-glow">
                        {updateCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-textFaint leading-none">{getMarketplacePluginCount(mp.id)}</span>
                </div>

                {/* Delete Button (Hidden unless hover) */}
                <div
                   onClick={(e) => handleRemoveMarketplace(e, mp)}
                   className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-red-500/20 text-textFaint hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all z-10"
                   title="Remove Marketplace"
                >
                   <Trash2 size={12} />
                </div>
              </button>
            );
          })}
        </div>
        )}

        {/* Add Marketplace Footer */}
        {currentScreen === 'plugins' && (
        <div className="p-3 border-t border-borderSubtle mt-auto">
          <button
             onClick={openAddMarketplaceModal}
             className="w-full flex items-center justify-center gap-2 py-2 rounded border border-dashed border-borderSubtle text-textMuted hover:text-textMain hover:bg-white/5 hover:border-textFaint transition-all text-[12px]"
          >
            <Plus size={14} />
            <span>Add Marketplace</span>
          </button>
        </div>
        )}

      </aside>

      {currentScreen === 'plugins' ? (
      <>
      {/* 2. MIDDLE COLUMN - PLUGIN LIST */}
      <div className="w-[380px] flex flex-col bg-bgBase border-r border-borderSubtle shrink-0">

        {/* Search Header */}
        <div className="h-14 flex items-center px-4 shrink-0 border-b border-borderSubtle">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textFaint" size={15} />
            <input
              type="text"
              placeholder={`Search in ${marketplaces.find(m => m.id === state.activeMarketplace)?.name}...`}
              value={state.searchQuery}
              onChange={(e) => setState(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full bg-bgSidebar border border-borderSubtle rounded-[4px] pl-9 pr-3 py-1.5 text-[13px] text-textMain placeholder:text-textFaint focus:outline-none focus:border-borderFocus transition-colors"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredPlugins.map(plugin => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              selected={state.selectedPluginId === plugin.id}
              onClick={() => setState(prev => ({ ...prev, selectedPluginId: plugin.id }))}
            />
          ))}
          {filteredPlugins.length === 0 && (
             <div className="flex flex-col items-center justify-center h-40 text-textFaint">
                <Package size={24} className="mb-2 opacity-50" />
                <span className="text-xs">No plugins found</span>
             </div>
          )}
        </div>

        {/* Footer Handle */}
        <div className="h-4 flex items-center justify-center border-t border-borderSubtle cursor-ns-resize hover:bg-white/5 bg-bgBase">
             <div className="w-10 h-1 rounded-full bg-borderSubtle"></div>
        </div>
      </div>

      {/* 3. RIGHT SIDEBAR - DETAILS */}
      <main className="flex-1 flex flex-col bg-bgSidebar min-w-0 relative z-10">
        <RightSidebar
          plugin={selectedPlugin}
          onUpdatePlugin={handlePluginUpdate}
          projectPath={currentProject?.path}
        />

        {/* Help Button */}
        <div className="absolute bottom-6 right-6">
          <button className="w-8 h-8 rounded-full bg-bgSurface border border-borderSubtle flex items-center justify-center text-textMuted hover:text-textMain shadow-lg hover:bg-bgSurfaceHover transition-all">
            <HelpCircle size={16} />
          </button>
        </div>
      </main>
      </>
      ) : (
      <McpPage projectPath={currentProject?.path || ''} />
      )}

      {/* Add Marketplace Modal */}
      {showAddMarketplaceModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-in fade-in duration-150">
          <div className="bg-bgSurface border border-borderSubtle rounded-xl shadow-float w-[420px] animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-borderSubtle">
              <h2 className="text-[15px] font-semibold text-textMain">Add Marketplace</h2>
              <button
                onClick={() => setShowAddMarketplaceModal(false)}
                className="p-1.5 rounded-md hover:bg-white/10 text-textFaint hover:text-textMain transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              <label className="block text-[12px] font-medium text-textMuted mb-2">
                Marketplace URL or Path
              </label>
              <input
                type="text"
                value={marketplaceUrl}
                onChange={(e) => setMarketplaceUrl(e.target.value)}
                placeholder="owner/repo"
                className="w-full bg-bgBase border border-borderSubtle rounded-lg px-4 py-2.5 text-[13px] text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && marketplaceUrl.trim()) {
                    handleAddMarketplace();
                  } else if (e.key === 'Escape') {
                    setShowAddMarketplaceModal(false);
                  }
                }}
              />
              <p className="mt-2.5 text-[11px] text-textFaint leading-relaxed">
                Supported formats:<br />
                <span className="text-textMuted font-mono">owner/repo</span> · <span className="text-textMuted font-mono">github.com/owner/repo</span> · <span className="text-textMuted font-mono">/local/path</span>
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-borderSubtle">
              <button
                onClick={() => setShowAddMarketplaceModal(false)}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-textMuted hover:text-textMain hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMarketplace}
                disabled={!marketplaceUrl.trim() || isAddingMarketplace}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {isAddingMarketplace ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Marketplace'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppContent />
        <ToastContainer />
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
