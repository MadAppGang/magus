import React from 'react';
import { Download, Trash2, RefreshCw, Box, LayoutGrid, Globe, Check, HardDrive } from 'lucide-react';
import { Plugin, Installation, Scope } from '../types';
import Badge from './Badge';

interface ScopeManagerProps {
  plugin: Plugin;
  installations: Installation[];
  onInstall: (pluginId: string, scope: Scope) => void;
  onUninstall: (pluginId: string, scope: Scope) => void;
  onUpdate: (pluginId: string, scope: Scope) => void;
}

const SCOPES: { key: Scope; label: string; icon: any }[] = [
  { key: 'local', label: 'Local', icon: HardDrive },
  { key: 'project', label: 'Project', icon: Box },
  { key: 'global', label: 'Global', icon: Globe },
];

const ScopeManager: React.FC<ScopeManagerProps> = ({ 
  plugin, 
  installations, 
  onInstall, 
  onUninstall, 
  onUpdate 
}) => {
  
  return (
    <div className="w-full bg-surface/50 border-t border-border">
      <div className="p-4 grid gap-1">
        {SCOPES.map((scope) => {
          const installation = installations.find(i => i.pluginId === plugin.id && i.scope === scope.key);
          const isInstalled = !!installation;
          const hasUpdate = isInstalled && installation.installedVersion !== plugin.version;
          const Icon = scope.icon;

          return (
            <div key={scope.key} className="flex items-center justify-between p-2 rounded-md hover:bg-surfaceHover/50 transition-colors group">
              {/* Left: Scope Info */}
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-md ${isInstalled ? 'text-textMain bg-surfaceHover' : 'text-textFaint'}`}>
                  <Icon size={14} />
                </div>
                <div className="flex flex-col">
                  <span className={`text-sm font-medium ${isInstalled ? 'text-textMain' : 'text-textFaint'}`}>
                    {scope.label}
                  </span>
                  {isInstalled ? (
                     <span className="text-[10px] text-textMuted font-mono">
                       v{installation.installedVersion}
                       {hasUpdate && <span className="text-amber-400 ml-1">• v{plugin.version} available</span>}
                     </span>
                  ) : (
                    <span className="text-[10px] text-textFaint">Not installed</span>
                  )}
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center">
                {!isInstalled ? (
                   <button
                    onClick={() => onInstall(plugin.id, scope.key)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded text-xs font-medium text-textMain hover:bg-white/10"
                   >
                     Install
                   </button>
                ) : (
                  <div className="flex items-center gap-1">
                     {hasUpdate && (
                        <button
                          onClick={() => onUpdate(plugin.id, scope.key)}
                          className="px-2 py-1.5 rounded text-xs font-medium text-amber-400 bg-amber-400/10 hover:bg-amber-400/20"
                        >
                          Update
                        </button>
                     )}
                     <button
                        onClick={() => onUninstall(plugin.id, scope.key)}
                        className="p-1.5 rounded text-textMuted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="Uninstall"
                     >
                        <Trash2 size={14} />
                     </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScopeManager;