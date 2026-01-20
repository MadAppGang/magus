import React, { useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, Edit2, Check, X } from 'lucide-react';
import { useMcpEnvVars, useSetMcpEnvVar, useRemoveMcpEnvVar } from '../../hooks/useMcpServers';
import { useToast } from '../Toast';

interface McpEnvVarsEditorProps {
  serverName: string;
  projectPath: string;
}

const McpEnvVarsEditor: React.FC<McpEnvVarsEditorProps> = ({ serverName, projectPath }) => {
  const [showValues, setShowValues] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editValue, setEditValue] = useState('');

  const { data: envVarsData } = useMcpEnvVars(serverName, projectPath);
  const setEnvMutation = useSetMcpEnvVar();
  const removeEnvMutation = useRemoveMcpEnvVar();
  const toast = useToast();

  // Extract envVars from potentially wrapped response
  const envVars = React.useMemo((): Record<string, string> => {
    if (!envVarsData) return {};
    if (typeof envVarsData === 'object' && 'envVars' in envVarsData) {
      return (envVarsData as unknown as { envVars: Record<string, string> }).envVars || {};
    }
    return envVarsData;
  }, [envVarsData]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      toast.addToast('Key and value are required', 'error');
      return;
    }

    try {
      await setEnvMutation.mutateAsync({
        serverName,
        key: newKey.trim(),
        value: newValue.trim(),
        projectPath,
      });
      toast.addToast('Environment variable added', 'success');
      setIsAdding(false);
      setNewKey('');
      setNewValue('');
    } catch (error) {
      toast.addToast(
        `Failed to add variable: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleEdit = async (key: string) => {
    if (!editValue.trim()) {
      toast.addToast('Value is required', 'error');
      return;
    }

    try {
      await setEnvMutation.mutateAsync({
        serverName,
        key,
        value: editValue.trim(),
        projectPath,
      });
      toast.addToast('Environment variable updated', 'success');
      setEditingKey(null);
      setEditValue('');
    } catch (error) {
      toast.addToast(
        `Failed to update variable: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const handleRemove = async (key: string) => {
    if (!window.confirm(`Remove environment variable "${key}"?`)) return;

    try {
      await removeEnvMutation.mutateAsync({
        serverName,
        key,
        projectPath,
      });
      toast.addToast('Environment variable removed', 'success');
    } catch (error) {
      toast.addToast(
        `Failed to remove variable: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  };

  const startEdit = (key: string, value: string) => {
    setEditingKey(key);
    setEditValue(value);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setNewKey('');
    setNewValue('');
  };

  const maskValue = (value: string): string => {
    return '•'.repeat(Math.min(value.length, 20));
  };

  const entries = Object.entries(envVars);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowValues(!showValues)}
          className="flex items-center gap-1.5 text-[11px] text-textMuted hover:text-textMain transition-colors"
        >
          {showValues ? <EyeOff size={12} /> : <Eye size={12} />}
          {showValues ? 'Hide values' : 'Show values'}
        </button>

        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-white/5 text-textMain hover:bg-white/10 border border-borderSubtle transition-colors"
          >
            <Plus size={12} />
            Add Variable
          </button>
        )}
      </div>

      {/* Variables List */}
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center gap-2 p-2.5 rounded bg-bgBase border border-borderSubtle"
            >
              {editingKey === key ? (
                // Edit Mode
                <>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={key}
                      disabled
                      className="px-2 py-1 rounded text-[12px] font-mono bg-bgSurface border border-borderSubtle text-textFaint cursor-not-allowed"
                    />
                    <input
                      type={showValues ? 'text' : 'password'}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="px-2 py-1 rounded text-[12px] font-mono bg-bgSidebar border border-borderSubtle text-textMain focus:outline-none focus:border-accent"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={() => handleEdit(key)}
                    className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                    title="Save"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="p-1.5 rounded hover:bg-white/10 text-textFaint hover:text-textMain transition-colors"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                // View Mode
                <>
                  <div className="flex-1 grid grid-cols-2 gap-2 text-[12px] font-mono">
                    <div className="text-textMain truncate">{key}</div>
                    <div className="text-textMuted truncate">
                      {showValues ? value : maskValue(value)}
                    </div>
                  </div>
                  <button
                    onClick={() => startEdit(key, value)}
                    className="p-1.5 rounded hover:bg-white/10 text-textFaint hover:text-textMain transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => handleRemove(key)}
                    className="p-1.5 rounded hover:bg-red-500/20 text-textFaint hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-textFaint text-[12px]">
          No environment variables configured
        </div>
      )}

      {/* Add New Variable */}
      {isAdding && (
        <div className="flex items-center gap-2 p-2.5 rounded bg-bgBase border border-accent/30">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="KEY"
              className="px-2 py-1 rounded text-[12px] font-mono bg-bgSidebar border border-borderSubtle text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent"
              autoFocus
            />
            <input
              type={showValues ? 'text' : 'password'}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              className="px-2 py-1 rounded text-[12px] font-mono bg-bgSidebar border border-borderSubtle text-textMain placeholder:text-textFaint focus:outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') cancelAdd();
              }}
            />
          </div>
          <button
            onClick={handleAdd}
            className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 transition-colors"
            title="Add"
          >
            <Check size={14} />
          </button>
          <button
            onClick={cancelAdd}
            className="p-1.5 rounded hover:bg-white/10 text-textFaint hover:text-textMain transition-colors"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default McpEnvVarsEditor;
