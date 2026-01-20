import React from 'react';
import { Server, Download, Check, AlertTriangle, Globe } from 'lucide-react';

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

interface McpServerCardProps {
  server: ExtendedMcpServer;
  selected: boolean;
  onClick: () => void;
}

const getCategoryColor = (category?: string): string => {
  switch (category) {
    case 'filesystem':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'database':
      return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    case 'api':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'productivity':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'development':
      return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    default:
      return 'bg-white/5 text-textFaint border-borderSubtle';
  }
};

const McpServerCard: React.FC<McpServerCardProps> = ({ server, selected, onClick }) => {
  const isInstalled = server.isInstalled !== false;
  const hasMissingEnvVars = isInstalled && server.missingEnvVars && server.missingEnvVars.length > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 transition-all border-l-2 hover:bg-white/[0.02] ${
        selected
          ? 'bg-white/[0.03] border-accent'
          : 'border-transparent'
      }`}
    >
      {/* Icon */}
      <div className={`p-2 rounded-md shrink-0 ${
        selected
          ? 'bg-accent/10 text-accent'
          : isInstalled
            ? 'bg-bgSurface text-textFaint'
            : 'bg-bgSurface text-textFaint/50'
      }`}>
        <Server size={16} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-[13px] font-medium truncate ${
            selected ? 'text-textMain' : isInstalled ? 'text-textMuted' : 'text-textMuted/70'
          }`}>
            {server.name}
          </span>
          {/* Status indicator */}
          {isInstalled ? (
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${
                server.enabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'bg-textFaint'
              }`}
              title={server.enabled ? 'Enabled' : 'Disabled'}
            />
          ) : (
            <div className="flex items-center gap-1 text-[10px] text-accent" title="Available to install">
              <Download size={10} />
            </div>
          )}
        </div>

        {/* Description */}
        {server.description && (
          <p className={`text-[11px] leading-relaxed mb-2 line-clamp-2 ${
            isInstalled ? 'text-textFaint' : 'text-textFaint/70'
          }`}>
            {server.description}
          </p>
        )}

        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {server.category && (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${getCategoryColor(server.category)}`}>
              {server.category}
            </span>
          )}
          {isInstalled && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Check size={8} />
              Installed
            </span>
          )}
          {hasMissingEnvVars && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20"
              title={`Missing: ${server.missingEnvVars!.join(', ')}`}
            >
              <AlertTriangle size={8} />
              Misconfigured
            </span>
          )}
          {server.isFromRegistry && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Globe size={8} />
              Registry
            </span>
          )}
          {server.version && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-textFaint border border-borderSubtle">
              v{server.version}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

export default McpServerCard;
