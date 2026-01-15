import React, { useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Download, Sparkles } from 'lucide-react';
import { Plugin, Installation, Scope } from '../types';
import Badge from './Badge';
import ScopeManager from './ScopeManager';

interface PluginCardProps {
  plugin: Plugin;
  installations: Installation[];
  onInstall: (id: string, scope: Scope) => void;
  onUninstall: (id: string, scope: Scope) => void;
  onUpdate: (id: string, scope: Scope) => void;
}

const PluginCard: React.FC<PluginCardProps> = ({ 
  plugin, 
  installations, 
  onInstall, 
  onUninstall, 
  onUpdate,
}) => {
  const [expanded, setExpanded] = useState(false);
  
  // Logic
  const myInstallations = installations.filter(i => i.pluginId === plugin.id);
  const isInstalled = myInstallations.length > 0;
  const hasUpdates = myInstallations.some(i => i.installedVersion !== plugin.latestVersion);

  return (
    <div className={`group flex flex-col bg-surface border rounded-lg transition-all duration-200 overflow-hidden ${expanded ? 'border-textFaint/40 shadow-lg' : 'border-border hover:border-surfaceHover'}`}>
      
      {/* Main Row */}
      <div 
        className="flex items-center p-4 gap-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-surfaceHover border border-white/5 flex items-center justify-center text-xl shrink-0">
          {plugin.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-textMain truncate">{plugin.name}</h3>
            {isInstalled && !hasUpdates && (
               <Badge variant="neutral">Installed</Badge>
            )}
            {hasUpdates && (
               <Badge variant="warning">Update</Badge>
            )}
          </div>
          <p className="text-xs text-textMuted truncate pr-4">
            {plugin.description}
          </p>
        </div>

        {/* Meta (Hidden on small screens) */}
        <div className="hidden md:flex flex-col items-end gap-1 shrink-0 text-right w-32">
           <span className="text-[10px] text-textFaint uppercase tracking-wider">{plugin.author}</span>
           <span className="text-xs text-textMuted">{(plugin.downloads / 1000).toFixed(1)}k <span className="text-textFaint">dl</span></span>
        </div>

        {/* Action Button Trigger */}
        <button 
          className={`shrink-0 px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
            isInstalled 
              ? 'bg-surfaceHover text-textMain border border-white/5 hover:bg-white/10' 
              : 'bg-primary text-primaryForeground hover:opacity-90'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {isInstalled ? (hasUpdates ? 'Update' : 'Manage') : 'Get'}
        </button>
      </div>

      {/* Expandable Details */}
      {expanded && (
        <ScopeManager 
          plugin={plugin} 
          installations={installations}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
};

export default PluginCard;