import React, { useState } from 'react';
import { X, Download, Plus, Trash2, PlayCircle, Code } from 'lucide-react';
import { useAddMcpServer, useCuratedMcpServers, useTestMcpConnection, CuratedMcpServer, McpServerConfig } from '../../hooks/useMcpServers';
import { useToast } from '../Toast';

interface AddMcpServerModalProps {
  projectPath: string;
  onClose: () => void;
}

type TabType = 'curated' | 'custom';
type CustomModeType = 'form' | 'json';

const getCategoryColor = (category: string): string => {
  switch (category) {
    case 'filesystem':
      return 'bg-blue-500/10 text-blue-400';
    case 'database':
      return 'bg-purple-500/10 text-purple-400';
    case 'api':
      return 'bg-green-500/10 text-green-400';
    case 'productivity':
      return 'bg-amber-500/10 text-amber-400';
    case 'development':
      return 'bg-cyan-500/10 text-cyan-400';
    default:
      return 'bg-white/5 text-textFaint';
  }
};

const AddMcpServerModal: React.FC<AddMcpServerModalProps> = ({ projectPath, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('curated');
  const [customMode, setCustomMode] = useState<CustomModeType>('form');
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);

  // Form state
  const [serverName, setServerName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);

  // JSON state
  const [jsonConfig, setJsonConfig] = useState('{\n  "command": "",\n  "args": [],\n  "env": {}\n}');

  const { data: curatedServers } = useCuratedMcpServers();
  const addServerMutation = useAddMcpServer();
  const testMutation = useTestMcpConnection();
  const toast = useToast();

  const handleInstallCurated = async (server: CuratedMcpServer) => {
    try {
      await addServerMutation.mutateAsync({
        name: server.name,
        config: {
          command: server.command,
          args: server.args,
          env: server.env,
        },
        projectPath,
      });
      toast.addToast(`${server.displayName} added successfully`, 'success');
      onClose();
    } catch (error) {
      toast.addToast(
        `Failed to add server: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const getConfigFromForm = (): McpServerConfig => {
    const config: McpServerConfig = {
      command: command.trim(),
      args: args.trim() ? args.split(',').map(a => a.trim()) : undefined,
    };

    if (envVars.length > 0) {
      config.env = {};
      envVars.forEach(({ key, value }) => {
        if (key.trim() && value.trim()) {
          config.env![key.trim()] = value.trim();
        }
      });
    }

    return config;
  };

  const getConfigFromJson = (): McpServerConfig | null => {
    try {
      return JSON.parse(jsonConfig);
    } catch {
      toast.addToast('Invalid JSON format', 'error');
      return null;
    }
  };

  const handleTestConnection = async () => {
    const config = customMode === 'form' ? getConfigFromForm() : getConfigFromJson();
    if (!config) return;

    setIsTesting(true);
    setTestResults(null);

    try {
      const result = await testMutation.mutateAsync({ config });
      setTestResults(result);

      if (result.success) {
        toast.addToast('Connection test passed', 'success');
      } else {
        toast.addToast('Connection test failed', 'error');
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

  const handleAddCustom = async () => {
    if (!serverName.trim()) {
      toast.addToast('Server name is required', 'error');
      return;
    }

    const config = customMode === 'form' ? getConfigFromForm() : getConfigFromJson();
    if (!config) return;

    // Require either command or URL
    if (!config.command?.trim() && !config.url?.trim()) {
      toast.addToast('Command or URL is required', 'error');
      return;
    }

    try {
      await addServerMutation.mutateAsync({
        name: serverName.trim(),
        config,
        projectPath,
      });
      toast.addToast('Server added successfully', 'success');
      onClose();
    } catch (error) {
      toast.addToast(
        `Failed to add server: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index][field] = value;
    setEnvVars(newVars);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-in fade-in duration-150">
      <div className="bg-bgSurface border border-borderSubtle rounded-xl shadow-float w-[720px] max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-borderSubtle shrink-0">
          <h2 className="text-[15px] font-semibold text-textMain">Add MCP Server</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-textFaint hover:text-textMain transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-borderSubtle shrink-0">
          <button
            onClick={() => setActiveTab('curated')}
            className={`flex-1 px-4 py-3 text-[13px] font-medium transition-colors ${
              activeTab === 'curated'
                ? 'text-accent border-b-2 border-accent'
                : 'text-textMuted hover:text-textMain'
            }`}
          >
            Curated Servers
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`flex-1 px-4 py-3 text-[13px] font-medium transition-colors ${
              activeTab === 'custom'
                ? 'text-accent border-b-2 border-accent'
                : 'text-textMuted hover:text-textMain'
            }`}
          >
            Custom Server
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'curated' ? (
            /* CURATED TAB */
            <div className="space-y-2">
              {curatedServers?.map(server => (
                <div
                  key={server.name}
                  className="flex items-start gap-3 p-3 rounded-lg border border-borderSubtle hover:bg-white/5 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[13px] font-medium text-textMain">{server.displayName}</h3>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getCategoryColor(server.category)}`}>
                        {server.category}
                      </span>
                    </div>
                    <p className="text-[12px] text-textMuted mb-2">{server.description}</p>
                    <div className="text-[11px] font-mono text-textFaint">
                      {server.command}
                    </div>
                  </div>
                  <button
                    onClick={() => handleInstallCurated(server)}
                    disabled={addServerMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shrink-0"
                  >
                    <Download size={12} />
                    Install
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* CUSTOM TAB */
            <div className="space-y-4">
              {/* Mode Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setCustomMode('form')}
                  className={`flex-1 px-3 py-2 rounded text-[12px] font-medium transition-colors ${
                    customMode === 'form'
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'bg-bgBase text-textMuted hover:text-textMain border border-borderSubtle'
                  }`}
                >
                  Form Mode
                </button>
                <button
                  onClick={() => setCustomMode('json')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[12px] font-medium transition-colors ${
                    customMode === 'json'
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'bg-bgBase text-textMuted hover:text-textMain border border-borderSubtle'
                  }`}
                >
                  <Code size={12} />
                  JSON Mode
                </button>
              </div>

              {customMode === 'form' ? (
                /* FORM MODE */
                <div className="space-y-4">
                  {/* Server Name */}
                  <div>
                    <label className="block text-[12px] font-medium text-textMuted mb-2">
                      Server Name
                    </label>
                    <input
                      type="text"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      placeholder="my-server"
                      className="w-full bg-bgBase border border-borderSubtle rounded-lg px-4 py-2.5 text-[13px] text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                    />
                  </div>

                  {/* Command */}
                  <div>
                    <label className="block text-[12px] font-medium text-textMuted mb-2">
                      Command
                    </label>
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="npx"
                      className="w-full bg-bgBase border border-borderSubtle rounded-lg px-4 py-2.5 text-[13px] font-mono text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                    />
                  </div>

                  {/* Args */}
                  <div>
                    <label className="block text-[12px] font-medium text-textMuted mb-2">
                      Arguments (comma separated)
                    </label>
                    <input
                      type="text"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="-y, @modelcontextprotocol/server-filesystem, /path"
                      className="w-full bg-bgBase border border-borderSubtle rounded-lg px-4 py-2.5 text-[13px] font-mono text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                    />
                  </div>

                  {/* Environment Variables */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[12px] font-medium text-textMuted">
                        Environment Variables
                      </label>
                      <button
                        onClick={addEnvVar}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-white/5 text-textMain hover:bg-white/10 border border-borderSubtle transition-colors"
                      >
                        <Plus size={10} />
                        Add
                      </button>
                    </div>

                    {envVars.length > 0 ? (
                      <div className="space-y-2">
                        {envVars.map((envVar, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={envVar.key}
                              onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                              placeholder="KEY"
                              className="flex-1 bg-bgBase border border-borderSubtle rounded px-3 py-2 text-[12px] font-mono text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent"
                            />
                            <input
                              type="text"
                              value={envVar.value}
                              onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                              placeholder="value"
                              className="flex-1 bg-bgBase border border-borderSubtle rounded px-3 py-2 text-[12px] font-mono text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent"
                            />
                            <button
                              onClick={() => removeEnvVar(index)}
                              className="p-2 rounded hover:bg-red-500/20 text-textFaint hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-textFaint text-[12px]">
                        No environment variables
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* JSON MODE */
                <div>
                  <label className="block text-[12px] font-medium text-textMuted mb-2">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="my-server"
                    className="w-full bg-bgBase border border-borderSubtle rounded-lg px-4 py-2.5 text-[13px] text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all mb-4"
                  />

                  <label className="block text-[12px] font-medium text-textMuted mb-2">
                    Configuration (JSON)
                  </label>
                  <textarea
                    value={jsonConfig}
                    onChange={(e) => setJsonConfig(e.target.value)}
                    className="w-full h-48 bg-bgBase border border-borderSubtle rounded-lg px-4 py-3 text-[12px] font-mono text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all resize-none"
                  />
                </div>
              )}

              {/* Test Results */}
              {testResults && (
                <div className={`p-3 rounded-lg border ${testResults.success ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                  <div className="text-[12px] font-medium mb-2">
                    {testResults.success ? '✓ Test Passed' : '✗ Test Failed'}
                  </div>
                  {testResults.steps && (
                    <div className="space-y-1">
                      {testResults.steps.map((step: any, i: number) => (
                        <div key={i} className="text-[11px] flex items-center gap-2">
                          <span>{step.passed ? '✓' : '✗'}</span>
                          <span className="text-textMuted">{step.step}</span>
                          {step.error && <span className="text-red-400">({step.error})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-borderSubtle shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-textMuted hover:text-textMain hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>

          {activeTab === 'custom' && (
            <>
              <button
                onClick={handleTestConnection}
                disabled={isTesting || !serverName.trim() || (customMode === 'form' ? !command.trim() : false)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-white/5 text-textMain hover:bg-white/10 border border-borderSubtle disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <PlayCircle size={14} />
                {isTesting ? 'Testing...' : 'Test'}
              </button>

              <button
                onClick={handleAddCustom}
                disabled={addServerMutation.isPending || !serverName.trim() || (customMode === 'form' ? !command.trim() : false)}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {addServerMutation.isPending ? 'Adding...' : 'Add Server'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddMcpServerModal;
