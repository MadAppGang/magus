import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Package, Globe, Activity, Layout, Store, 
  HelpCircle, ChevronDown, FolderOpen, Plus, Trash2, Folder, History, Check
} from 'lucide-react';
import { Plugin, AppState, Marketplace, Project } from './types';
import { MOCK_PLUGINS, MOCK_MARKETPLACES, MOCK_PROJECTS } from './constants';
import PluginRow from './components/PluginRow';
import RightSidebar from './components/RightSidebar';

const App: React.FC = () => {
  // --- State ---
  // Merged state: plugins now contain their own status
  const [plugins, setPlugins] = useState<Plugin[]>(MOCK_PLUGINS);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>(MOCK_MARKETPLACES);
  const [projects] = useState<Project[]>(MOCK_PROJECTS);
  
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<AppState>({
    activeMarketplace: 'magus',
    activeProjectId: 'proj_1',
    searchQuery: '',
    selectedPluginId: null
  });

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
  const handlePluginUpdate = (updatedPlugin: Plugin) => {
    setPlugins(prev => prev.map(p => p.id === updatedPlugin.id ? updatedPlugin : p));
  };

  // Marketplace Management
  const handleAddMarketplace = () => {
    const name = window.prompt("Enter Marketplace Name:");
    if (name) {
      const newId = name.toLowerCase().replace(/\s+/g, '-');
      const newMp: Marketplace = {
        id: newId,
        name: name,
        count: '0 plugins',
        icon: 'package'
      };
      setMarketplaces(prev => [...prev, newMp]);
      setState(prev => ({...prev, activeMarketplace: newId}));
    }
  };

  const handleRemoveMarketplace = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm("Remove this marketplace?")) {
      setMarketplaces(prev => prev.filter(mp => mp.id !== id));
      if (state.activeMarketplace === id) {
        setState(prev => ({...prev, activeMarketplace: marketplaces[0].id}));
      }
    }
  };

  const handleSwitchProject = (projectId: string) => {
    setState(prev => ({...prev, activeProjectId: projectId}));
    setIsProjectMenuOpen(false);
  };

  // --- Derived ---
  const activeProject = projects.find(p => p.id === state.activeProjectId) || projects[0];

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
                <span className="text-[12px] font-medium text-textMain truncate leading-tight">{activeProject.name}</span>
                <span className="text-[10px] text-textFaint truncate font-mono leading-tight opacity-70">
                  {activeProject.path.split('/').pop()}
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
                  className={`flex items-center gap-2.5 px-2 py-2 rounded text-left transition-colors ${
                    proj.id === activeProject.id ? 'bg-accent/10 text-textMain' : 'hover:bg-white/5 text-textMuted hover:text-textMain'
                  }`}
                >
                  <History size={13} className={proj.id === activeProject.id ? 'text-accent' : 'text-textFaint'} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[12px] font-medium truncate">{proj.name}</span>
                    <span className="text-[10px] text-textFaint truncate">{proj.path}</span>
                  </div>
                  {proj.id === activeProject.id && <Check size={12} className="text-accent" />}
                </button>
              ))}
              
              <div className="h-px bg-borderSubtle my-1" />
              
              <button className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-white/5 text-textMain text-left transition-colors">
                <FolderOpen size={13} className="text-textFaint" />
                <span className="text-[12px] font-medium">Open Folder...</span>
              </button>
            </div>
          )}
        </div>
        
        {/* Marketplace List */}
        <div className="flex-1 py-2 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] font-semibold text-textFaint uppercase tracking-wider flex items-center justify-between">
            <span>Registries</span>
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
                  <span className="text-[11px] text-textFaint leading-none">{mp.count}</span>
                </div>

                {/* Delete Button (Hidden unless hover) */}
                <div 
                   onClick={(e) => handleRemoveMarketplace(e, mp.id)}
                   className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-red-500/20 text-textFaint hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all z-10"
                   title="Remove Registry"
                >
                   <Trash2 size={12} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Add Marketplace Footer */}
        <div className="p-3 border-t border-borderSubtle mt-auto">
          <button 
             onClick={handleAddMarketplace}
             className="w-full flex items-center justify-center gap-2 py-2 rounded border border-dashed border-borderSubtle text-textMuted hover:text-textMain hover:bg-white/5 hover:border-textFaint transition-all text-[12px]"
          >
            <Plus size={14} />
            <span>Add Registry</span>
          </button>
        </div>

      </aside>

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
        />
        
        {/* Help Button */}
        <div className="absolute bottom-6 right-6">
          <button className="w-8 h-8 rounded-full bg-bgSurface border border-borderSubtle flex items-center justify-center text-textMuted hover:text-textMain shadow-lg hover:bg-bgSurfaceHover transition-all">
            <HelpCircle size={16} />
          </button>
        </div>
      </main>

    </div>
  );
};

export default App;