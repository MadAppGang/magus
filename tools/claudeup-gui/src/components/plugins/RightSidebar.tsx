import React, { useState } from 'react';
import {
  ChevronDown, ChevronUp, Share2, Globe,
  Box, Trash2, RefreshCw, HardDrive, Terminal, Zap, Shield, Link,
  Check, Download
} from 'lucide-react';
import { Plugin, Capability } from '../../types';
import { useEnablePlugin, useDisablePlugin } from '../../hooks/usePlugins';
import { useToast } from '../Toast';

interface RightSidebarProps {
  plugin: Plugin | undefined;
  onUpdatePlugin: (updated: Plugin) => void;
}

const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

const Section: React.FC<{ title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, count, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-borderSubtle last:border-0 shrink-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-textMain uppercase tracking-wide">{title}</span>
          {count !== undefined && (
            <span className="bg-white/5 text-textFaint text-[10px] px-1.5 py-0.5 rounded-full font-mono">{count}</span>
          )}
        </div>
        {isOpen ? <ChevronUp size={14} className="text-textFaint" /> : <ChevronDown size={14} className="text-textFaint" />}
      </button>
      {isOpen && (
        <div className="px-6 pb-6 pt-0 text-[13px] text-textMuted leading-relaxed animate-in slide-in-from-top-2 duration-200 overflow-visible">
          {children}
        </div>
      )}
    </div>
  );
}

const CapabilityBadge: React.FC<{ icon: React.ElementType; capability: Capability; colorClass: string }> = ({ icon: Icon, capability, colorClass }) => {
  const [isClicked, setIsClicked] = useState(false);

  return (
  <div
    className="relative inline-flex group"
    onClick={() => setIsClicked(!isClicked)}
  >
    <div className={`
      inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded
      bg-bgSurface/40 border border-borderSubtle
      hover:bg-bgSurface hover:border-textFaint/30 hover:shadow-sm
      cursor-pointer transition-all duration-200
      ${isClicked ? 'bg-bgSurface border-textFaint/50 ring-1 ring-white/5' : ''}
    `}>
      <Icon size={12} className={`${colorClass} opacity-70 group-hover:opacity-100 transition-opacity`} />
      <span className="text-[12px] font-medium text-textMain/90 group-hover:text-textMain">{capability.name}</span>
    </div>

    {/* Tooltip */}
    <div className={`
      absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 rounded-lg
      bg-[#2a2b30] border border-white/10 shadow-float z-50
      transition-all duration-200 origin-bottom
      ${isClicked ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible group-hover:opacity-100 group-hover:scale-100 group-hover:visible'}
    `}>
      <div className="flex items-start gap-2 mb-1">
        <Icon size={12} className={`${colorClass} mt-0.5`} />
        <span className="text-[11px] font-bold text-textMain leading-tight">{capability.name}</span>
      </div>
      <p className="text-[11px] text-textMuted leading-relaxed">
        {capability.description || "No description available."}
      </p>

      {/* Triangle Arrow */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-4 border-transparent border-t-[#2a2b30]"></div>
    </div>
  </div>
)};

const RightSidebar: React.FC<RightSidebarProps> = ({
  plugin,
  onUpdatePlugin: _onUpdatePlugin
}) => {
  const enableMutation = useEnablePlugin();
  const disableMutation = useDisablePlugin();
  const toast = useToast();

  if (!plugin) return (
    <div className="h-full flex flex-col items-center justify-center text-textFaint">
      <Box size={48} className="mb-4 opacity-20" />
      <p>Select a plugin to view details</p>
    </div>
  );

  const handleScopeToggle = async (scopeName: 'userScope' | 'projectScope', currentState: boolean) => {
    const scope = scopeName === 'userScope' ? 'global' : 'project';
    const mutation = currentState ? disableMutation : enableMutation;
    const action = currentState ? 'disable' : 'enable';

    try {
      await mutation.mutateAsync({
        pluginId: plugin.id,
        enabled: !currentState,
        scope,
      });
      toast.addToast(
        `Plugin ${action}d successfully in ${scope} scope`,
        'success'
      );
    } catch (error) {
      console.error('Failed to toggle plugin:', error);
      toast.addToast(
        `Failed to ${action} plugin: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  // Helper for scope rendering
  const renderScopeCard = (label: string, icon: React.ElementType, scopeData: any, scopeKey: 'userScope' | 'projectScope' | 'localScope') => {
    const isConfigured = !!scopeData;
    const isEnabled = scopeData?.enabled;

    // Determine Status Style
    let statusBg = "bg-transparent";
    let statusBorder = "border-transparent";

    if (isConfigured) {
      if (isEnabled) {
        statusBg = "bg-emerald-500/5";
        statusBorder = "border-emerald-500/10";
      } else {
        statusBg = "bg-bgSurface";
        statusBorder = "border-white/5";
      }
    }

    const Icon = icon;

    return (
      <div className={`flex flex-col p-3 rounded-lg border ${isConfigured ? statusBorder : 'border-borderSubtle border-dashed'} ${statusBg} transition-all`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon size={14} className={isConfigured ? "text-textMain" : "text-textFaint"} />
            <span className="text-[11px] font-semibold text-textMain uppercase tracking-wider">{label}</span>
          </div>
          {isConfigured && (
            <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'bg-textFaint'}`} />
          )}
        </div>

        <div className="flex-1 flex flex-col justify-end">
          {isConfigured ? (
            <>
              <div className="text-[12px] font-mono text-textMuted mb-2">
                v{scopeData.version || '???'}
              </div>
              {scopeKey !== 'localScope' && (
                <button
                  onClick={() => handleScopeToggle(scopeKey as 'userScope' | 'projectScope', isEnabled)}
                  disabled={enableMutation.isPending || disableMutation.isPending}
                  className={`w-full py-1.5 px-2 rounded text-[10px] font-medium border transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isEnabled
                      ? 'bg-bgBase border-borderSubtle text-textMuted hover:text-red-400 hover:border-red-500/30'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                  }`}
                >
                  {(enableMutation.isPending || disableMutation.isPending) ? 'Loading...' : (isEnabled ? 'Disable' : 'Enable')}
                </button>
              )}
              {scopeKey === 'localScope' && (
                <div className="text-[10px] text-textFaint italic py-1.5 text-center">
                  Managed via file system
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-textFaint text-center py-4">
              Not configured
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto">

      {/* HEADER */}
      <div className="shrink-0 px-8 pt-10 pb-8 border-b border-borderSubtle bg-bgSidebar relative overflow-hidden">
        <div className="absolute top-0 right-0 p-32 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-start justify-between mb-6">
            <div className="w-[64px] h-[64px] rounded-xl bg-bgSurface border border-borderSubtle flex items-center justify-center text-2xl text-textMuted font-medium shadow-lg">
              {getInitials(plugin.name)}
            </div>
            <div className="flex gap-2">
              {plugin.homepage && (
                <a href="#" className="p-2 rounded-full bg-bgSurface border border-borderSubtle text-textMuted hover:text-textMain hover:bg-white/5 transition-colors">
                  <Link size={16} />
                </a>
              )}
              <button className="p-2 rounded-full bg-bgSurface border border-borderSubtle text-textMuted hover:text-textMain hover:bg-white/5 transition-colors">
                <Share2 size={16} />
              </button>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-textMain mb-2">{plugin.name}</h1>

          <div className="flex items-center gap-4 mb-6 text-[13px] text-textMuted">
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/5 border border-white/5">
              v{plugin.version}
            </span>
            <span className="text-textFaint">by</span>
            <span className="text-textMain font-medium hover:underline cursor-pointer">
              {plugin.author?.name}
            </span>
            {plugin.author?.company && (
              <>
                <span className="text-textFaint">•</span>
                <span>{plugin.author.company}</span>
              </>
            )}
          </div>

          {/* Primary Actions */}
          <div className="flex items-center gap-3">
            {plugin.installedVersion ? (
              <>
                {plugin.hasUpdate ? (
                  <button className="flex-1 bg-accent hover:bg-accentHover text-white py-2.5 px-4 rounded-md font-medium text-sm shadow-glow flex items-center justify-center gap-2 transition-all">
                    <RefreshCw size={16} /> Update to v{plugin.version}
                  </button>
                ) : (
                  <button className="flex-1 bg-bgSurface border border-borderSubtle text-textFaint py-2.5 px-4 rounded-md font-medium text-sm cursor-default flex items-center justify-center gap-2">
                    <Check size={16} /> Up to Date
                  </button>
                )}
                <button className="px-4 py-2.5 rounded-md border border-borderSubtle bg-bgSurface hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 text-textMuted transition-colors">
                  <Trash2 size={16} />
                </button>
              </>
            ) : (
              <button className="flex-1 bg-white text-bgBase hover:bg-gray-200 py-2.5 px-4 rounded-md font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all">
                <Download size={16} /> Install Plugin
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SCOPE MANAGEMENT */}
      <div className="shrink-0 p-6 border-b border-borderSubtle bg-bgBase/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[12px] font-semibold text-textFaint uppercase tracking-wider">Installation Scopes</h3>
          <div className="flex items-center gap-1 text-[10px] text-textFaint bg-white/5 px-2 py-0.5 rounded">
            <Shield size={10} />
            Priority: Local &gt; Project &gt; Global
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {renderScopeCard("Local", HardDrive, plugin.localScope, 'localScope')}
          {renderScopeCard("Project", Box, plugin.projectScope, 'projectScope')}
          {renderScopeCard("Global", Globe, plugin.userScope, 'userScope')}
        </div>
      </div>

      {/* DESCRIPTION */}
      <div className="shrink-0 p-6 border-b border-borderSubtle">
        <h3 className="text-[13px] font-semibold text-textMain mb-3">About</h3>
        <p className="text-[13px] text-textMuted leading-relaxed whitespace-pre-line">
          {plugin.description}
        </p>
        {plugin.keywords && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {plugin.keywords.slice(0, 6).map(k => (
              <span key={k} className="text-[11px] text-textFaint bg-bgSurface px-2 py-1 rounded border border-borderSubtle">
                #{k}
              </span>
            ))}
            {plugin.keywords.length > 6 && (
              <span className="text-[11px] text-textFaint px-2 py-1">+{plugin.keywords.length - 6} more</span>
            )}
          </div>
        )}
      </div>

      {/* CAPABILITIES */}
      <div className="shrink-0">
        {(plugin.agents?.length || 0) > 0 && (
          <Section title="AI Agents" count={plugin.agents?.length}>
            <div className="flex flex-wrap gap-2">
              {plugin.agents?.map(agent => (
                <CapabilityBadge key={agent.name} capability={agent} icon={Box} colorClass="text-blue-400" />
              ))}
            </div>
          </Section>
        )}

        {(plugin.commands?.length || 0) > 0 && (
          <Section title="Slash Commands" count={plugin.commands?.length}>
            <div className="flex flex-wrap gap-2">
              {plugin.commands?.map(cmd => (
                <CapabilityBadge key={cmd.name} capability={cmd} icon={Terminal} colorClass="text-emerald-400" />
              ))}
            </div>
          </Section>
        )}

        {(plugin.skills?.length || 0) > 0 && (
          <Section title="Skills & Tools" count={plugin.skills?.length}>
            <div className="flex flex-wrap gap-2">
              {plugin.skills?.map(skill => (
                <CapabilityBadge key={skill.name} capability={skill} icon={Zap} colorClass="text-amber-400" />
              ))}
            </div>
          </Section>
        )}

        <Section title="System Details" defaultOpen={false}>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span>License</span>
              <span className="text-textMain">{plugin.license || 'Proprietary'}</span>
            </div>
            <div className="flex justify-between">
              <span>Registry ID</span>
              <span className="font-mono text-[11px] bg-bgSurface px-1.5 rounded">{plugin.id}</span>
            </div>
            <div className="flex justify-between">
              <span>Hooks Config</span>
              <span className="font-mono text-[11px]">{plugin.hooks ? 'Custom' : 'None'}</span>
            </div>
          </div>
        </Section>
      </div>

    </div>
  );
};

export default RightSidebar;
