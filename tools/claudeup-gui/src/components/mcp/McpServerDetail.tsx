import React, { useState } from 'react';
import {
  Server, Terminal, Trash2, PlayCircle, AlertCircle, CheckCircle2, XCircle, Download, ExternalLink, Github, Package, Calendar, Globe, Key, Lock, Wifi
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { useToggleMcpServer, useRemoveMcpServer, useTestMcpConnection, useMcpServerStatus, useAddMcpServer, CuratedMcpServer } from '../../hooks/useMcpServers';
import { useToast } from '../Toast';
import McpEnvVarsEditor from './McpEnvVarsEditor';

// Environment variable from registry
interface RegistryEnvVar {
  name: string;
  description?: string;
  isSecret?: boolean;
  format?: string;
}

// Extended server type that includes installation status
interface ExtendedMcpServer {
  name: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  category?: string;
  description?: string;
  isInstalled?: boolean;
  curatedConfig?: CuratedMcpServer;
  requiredEnv?: string[];
  missingEnvVars?: string[];
  isFromRegistry?: boolean;
  registryUrl?: string;
  version?: string;
  sourceCodeUrl?: string;
  packageRegistry?: string;
  publishedAt?: string;
  updatedAt?: string;
  transportType?: string;
  registryEnvVars?: RegistryEnvVar[];
  isLatest?: boolean;
  remoteUrl?: string;
  packageIdentifier?: string;
  repositorySource?: string;
}

// Format relative date
function formatRelativeDate(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

interface McpServerDetailProps {
  server: ExtendedMcpServer | undefined;
  projectPath: string;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  return (
    <div className="border-b border-borderSubtle last:border-0 shrink-0 w-full">
      <div className="px-8 py-5 w-full">
        <h3 className="text-[13px] font-semibold text-textMain uppercase tracking-wide mb-3">{title}</h3>
        <div className="text-[13px] text-textMuted leading-relaxed w-full">
          {children}
        </div>
      </div>
    </div>
  );
};

const McpServerDetail: React.FC<McpServerDetailProps> = ({ server, projectPath }) => {
  const [isTesting, setIsTesting] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const toggleMutation = useToggleMcpServer();
  const removeMutation = useRemoveMcpServer();
  const testMutation = useTestMcpConnection();
  const addMutation = useAddMcpServer();
  const toast = useToast();

  const isInstalled = server?.isInstalled !== false;
  const { data: status } = useMcpServerStatus(isInstalled ? server?.name : undefined, projectPath);

  if (!server) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-textFaint">
        <Server size={48} className="mb-4 opacity-20" />
        <p>Select a server to view details</p>
      </div>
    );
  }

  const handleInstall = async () => {
    // Check if we can install (either curated config or registry server with command)
    const canInstall = server.curatedConfig || (server.isFromRegistry && server.command);
    if (!canInstall) return;

    setIsInstalling(true);
    try {
      // Use curated config if available, otherwise use registry server config
      const config = server.curatedConfig
        ? {
            command: server.curatedConfig.command,
            args: server.curatedConfig.args,
            env: server.curatedConfig.env,
          }
        : {
            command: server.command!,
            args: server.args,
          };

      await addMutation.mutateAsync({
        name: server.name,
        config,
        projectPath,
      });
      toast.addToast(`${server.name} installed successfully`, 'success');
    } catch (error) {
      toast.addToast(
        `Failed to install: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      setIsInstalling(false);
    }
  };

  const handleToggle = async () => {
    try {
      await toggleMutation.mutateAsync({
        name: server.name,
        enabled: !server.enabled,
        projectPath,
      });
      toast.addToast(
        `Server ${server.enabled ? 'disabled' : 'enabled'} successfully`,
        'success'
      );
    } catch (error) {
      toast.addToast(
        `Failed to toggle server: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove server "${server.name}"?`)) return;

    try {
      await removeMutation.mutateAsync({
        name: server.name,
        projectPath,
      });
      toast.addToast('Server removed successfully', 'success');
    } catch (error) {
      toast.addToast(
        `Failed to remove server: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      // Check if this is an HTTP-based server (has url but no command)
      const serverUrl = server.remoteUrl || server.curatedConfig?.url;
      const serverCommand = server.command || server.curatedConfig?.command;

      const result = await testMutation.mutateAsync({
        config: {
          command: serverCommand || undefined,
          args: server.args || server.curatedConfig?.args,
          url: serverUrl,
        },
      });

      if (result.success) {
        toast.addToast('Connection test passed', 'success');
      } else {
        toast.addToast(
          `Connection test failed: ${result.error || 'Unknown error'}`,
          'error'
        );
      }
    } catch (error) {
      toast.addToast(
        `Failed to test connection: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      setIsTesting(false);
    }
  };

  const getStatusIcon = () => {
    if (!isInstalled) return <Download size={16} className="text-accent" />;
    if (!status) return <AlertCircle size={16} className="text-textFaint" />;
    switch (status.state) {
      case 'running':
        return <CheckCircle2 size={16} className="text-emerald-400" />;
      case 'stopped':
        return <XCircle size={16} className="text-textFaint" />;
      case 'error':
        return <AlertCircle size={16} className="text-red-400" />;
      default:
        return <AlertCircle size={16} className="text-textFaint" />;
    }
  };

  const getStatusText = () => {
    if (!isInstalled) return 'Available';
    if (!status) return 'Unknown';
    return status.state.charAt(0).toUpperCase() + status.state.slice(1);
  };

  const command = server.command || server.curatedConfig?.command;
  const args = server.args || server.curatedConfig?.args;
  const docsUrl = server.curatedConfig?.docsUrl;

  return (
    <div className="h-full w-full flex flex-col overflow-y-auto">
      {/* HEADER */}
      <div className="shrink-0 px-8 pt-10 pb-8 border-b border-borderSubtle bg-bgSidebar relative overflow-hidden w-full">
        <div className="absolute top-0 right-0 p-32 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-start justify-between mb-6">
            <h1 className="text-2xl font-bold text-textMain">{server.name}</h1>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className="text-[12px] text-textMuted">{getStatusText()}</span>
            </div>
          </div>

          {server.description && (
            <p className="text-[13px] text-textMuted mb-4">{server.description}</p>
          )}

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {server.category && (
              <span className="inline-block px-2 py-1 rounded text-[11px] font-medium bg-white/5 text-textFaint border border-borderSubtle">
                {server.category}
              </span>
            )}
            {server.version && (
              <span className="inline-block px-2 py-1 rounded text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                v{server.version}
              </span>
            )}
            {server.isFromRegistry && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Globe size={10} />
                Registry
              </span>
            )}
            {server.transportType && (
              <span className="inline-block px-2 py-1 rounded text-[11px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {server.transportType}
              </span>
            )}
            {server.isLatest && (
              <span className="inline-block px-2 py-1 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Latest
              </span>
            )}
            {!isInstalled && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-accent/10 text-accent border border-accent/20">
                <Download size={10} />
                Available to install
              </span>
            )}
          </div>

          {/* Links row */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            {server.sourceCodeUrl && (
              <button
                onClick={() => open(server.sourceCodeUrl!)}
                className="inline-flex items-center gap-1.5 text-[12px] text-textMuted hover:text-textMain transition-colors"
              >
                <Github size={14} />
                Source Code
              </button>
            )}
            {docsUrl && (
              <button
                onClick={() => open(docsUrl)}
                className="inline-flex items-center gap-1.5 text-[12px] text-textMuted hover:text-textMain transition-colors"
              >
                <ExternalLink size={14} />
                Documentation
              </button>
            )}
            {server.packageRegistry && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-textFaint">
                <Package size={14} />
                {server.packageRegistry}
              </span>
            )}
            {server.publishedAt && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-textFaint">
                <Calendar size={14} />
                Published {formatRelativeDate(server.publishedAt)}
              </span>
            )}
            {server.updatedAt && server.updatedAt !== server.publishedAt && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-textFaint">
                Updated {formatRelativeDate(server.updatedAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* COMMAND INFO */}
      {command && (
        <Section title="Command">
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Terminal size={14} className="text-textFaint mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] bg-bgBase px-3 py-2 rounded border border-borderSubtle break-all">
                  {command}
                </div>
              </div>
            </div>

            {args && args.length > 0 && (
              <div className="ml-6">
                <div className="text-[11px] text-textFaint mb-1">Arguments:</div>
                <div className="font-mono text-[12px] bg-bgBase px-3 py-2 rounded border border-borderSubtle">
                  {args.join(' ')}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* CONNECTION INFO - For HTTP-based remote servers */}
      {server.remoteUrl && (
        <Section title="Connection">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Wifi size={14} className="text-cyan-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-textFaint mb-1">Remote Endpoint</div>
                <div className="font-mono text-[12px] bg-bgBase px-3 py-2 rounded border border-borderSubtle break-all text-cyan-400">
                  {server.remoteUrl}
                </div>
              </div>
            </div>
            {server.transportType && (
              <div className="flex items-center gap-2 text-[12px] text-textFaint">
                <span>Transport:</span>
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[11px] font-medium">
                  {server.transportType}
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* PACKAGE INFO - For npm-based servers */}
      {server.packageIdentifier && !server.remoteUrl && (
        <Section title="Package">
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Package size={14} className="text-textFaint mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] bg-bgBase px-3 py-2 rounded border border-borderSubtle break-all">
                  {server.packageIdentifier}
                </div>
              </div>
            </div>
            {server.transportType && (
              <div className="flex items-center gap-2 text-[12px] text-textFaint ml-6">
                <span>Transport:</span>
                <span className="px-2 py-0.5 rounded bg-white/5 text-textMuted border border-borderSubtle text-[11px] font-medium">
                  {server.transportType}
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* REQUIRED ENVIRONMENT VARIABLES - For registry servers not yet installed */}
      {!isInstalled && server.registryEnvVars && server.registryEnvVars.length > 0 && (
        <Section title="Required Configuration">
          <div className="space-y-3">
            <p className="text-[12px] text-textFaint mb-3">
              This server requires the following environment variables to be configured after installation:
            </p>
            <div className="space-y-2">
              {server.registryEnvVars.map((envVar) => (
                <div
                  key={envVar.name}
                  className="p-3 rounded bg-bgBase border border-borderSubtle"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {envVar.isSecret ? (
                      <Lock size={12} className="text-amber-400" />
                    ) : (
                      <Key size={12} className="text-textFaint" />
                    )}
                    <span className="font-mono text-[12px] text-textMain font-medium">
                      {envVar.name}
                    </span>
                    {envVar.isSecret && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Secret
                      </span>
                    )}
                  </div>
                  {envVar.description && (
                    <p className="text-[11px] text-textFaint ml-5">
                      {envVar.description}
                    </p>
                  )}
                  {envVar.format && (
                    <p className="text-[10px] text-textFaint/70 ml-5 mt-1 font-mono">
                      Format: {envVar.format}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* STATUS - Only for installed servers */}
      {isInstalled && (
        <Section title="Status">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span>Enabled</span>
              <button
                onClick={handleToggle}
                disabled={toggleMutation.isPending}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  server.enabled ? 'bg-emerald-500' : 'bg-textFaint/30'
                } ${toggleMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    server.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {status?.error && (
              <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{status.error}</span>
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* MISSING ENV VARS WARNING - Only for installed servers */}
      {isInstalled && server.missingEnvVars && server.missingEnvVars.length > 0 && (
        <Section title="Configuration Warning">
          <div className="p-3 rounded bg-red-500/10 border border-red-500/20">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
              <div className="flex-1">
                <div className="text-red-400 text-[12px] font-medium mb-1">
                  Missing required environment variables
                </div>
                <div className="text-red-400/80 text-[11px]">
                  The following variables are required but not configured:
                </div>
                <ul className="mt-2 space-y-1">
                  {server.missingEnvVars.map(envVar => (
                    <li key={envVar} className="flex items-center gap-2 text-red-400 text-[12px] font-mono">
                      <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
                      {envVar}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ENVIRONMENT VARIABLES - Only for installed servers */}
      {isInstalled && (
        <Section title="Environment Variables">
          <McpEnvVarsEditor
            serverName={server.name}
            projectPath={projectPath}
          />
        </Section>
      )}

      {/* ACTIONS */}
      <div className="shrink-0 px-8 py-6 border-t border-borderSubtle mt-auto w-full">
        <div className="flex gap-3 w-full">
          {isInstalled ? (
            <>
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <PlayCircle size={16} />
                {isTesting ? 'Testing...' : 'Test Connection'}
              </button>

              <button
                onClick={handleRemove}
                disabled={removeMutation.isPending}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-[13px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Trash2 size={16} />
                {removeMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </>
          ) : (
            <button
              onClick={handleInstall}
              disabled={isInstalling || (!server.curatedConfig && !server.command)}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-[14px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Download size={18} />
              {isInstalling ? 'Installing...' : 'Install Server'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default McpServerDetail;
