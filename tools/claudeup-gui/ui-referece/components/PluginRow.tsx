import React from 'react';
import { Plugin } from '../types';
import { Zap, Terminal, Box, ArrowUpCircle, CheckCircle, AlertCircle } from 'lucide-react';

interface PluginRowProps {
  plugin: Plugin;
  selected: boolean;
  onClick: () => void;
}

const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

// Category Color Mapping
const getCategoryColor = (cat: string) => {
  switch (cat) {
    case 'development': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'media': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    case 'workflow': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'content': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    default: return 'bg-white/5 text-textMuted border-white/10';
  }
};

const PluginRow: React.FC<PluginRowProps> = ({ plugin, selected, onClick }) => {
  const isInstalled = !!plugin.installedVersion;
  
  return (
    <div 
      onClick={onClick}
      className={`group flex flex-col gap-3 px-4 py-4 border-b border-borderSubtle cursor-pointer transition-colors ${
        selected 
          ? 'bg-bgSurface/40' 
          : 'bg-bgBase hover:bg-bgSurface/20'
      }`}
    >
      {/* Top Row: Icon, Name, Status */}
      <div className="flex items-start gap-3.5">
        <div className="w-[42px] h-[42px] shrink-0 rounded-lg bg-bgSurface border border-borderSubtle flex items-center justify-center text-textMuted font-medium text-[14px] relative mt-0.5 shadow-sm">
          {getInitials(plugin.name)}
          {plugin.hasUpdate && (
             <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-accent border-2 border-bgBase"></span>
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="text-[14px] font-semibold text-textMain truncate">{plugin.name}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wider ${getCategoryColor(plugin.category)}`}>
                {plugin.category}
              </span>
            </div>
            
            {/* Status Badge */}
            <div className="shrink-0 ml-2">
              {plugin.hasUpdate ? (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-accent text-white px-1.5 py-0.5 rounded-[2px] shadow-glow">
                  <ArrowUpCircle size={10} /> Update
                </span>
              ) : isInstalled ? (
                plugin.enabled ? (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                    <CheckCircle size={10} /> v{plugin.installedVersion}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-textFaint">
                    Disabled
                  </span>
                )
              ) : (
                <span className="text-[10px] font-medium text-textFaint border border-white/5 px-1.5 py-0.5 rounded">
                  Get
                </span>
              )}
            </div>
          </div>
          
          <p className="text-[12px] text-textMuted leading-relaxed line-clamp-2 pr-2">
            {plugin.description}
          </p>
        </div>
      </div>

      {/* Bottom Row: Capabilities & Metadata */}
      <div className="flex items-center justify-between pl-[56px]">
        <div className="flex items-center gap-3 text-[11px] text-textFaint">
          {(plugin.agents?.length || 0) > 0 && (
             <div className="flex items-center gap-1" title="Agents">
                <Box size={11} className="text-blue-400/70" />
                <span>{plugin.agents?.length}</span>
             </div>
          )}
          {(plugin.commands?.length || 0) > 0 && (
             <div className="flex items-center gap-1" title="Slash Commands">
                <Terminal size={11} className="text-emerald-400/70" />
                <span>{plugin.commands?.length}</span>
             </div>
          )}
          {(plugin.skills?.length || 0) > 0 && (
             <div className="flex items-center gap-1" title="Skills">
                <Zap size={11} className="text-amber-400/70" />
                <span>{plugin.skills?.length}</span>
             </div>
          )}
        </div>
        
        <div className="text-[10px] text-textFaint truncate max-w-[120px] opacity-70">
           {plugin.author?.name}
        </div>
      </div>
    </div>
  );
};

export default PluginRow;