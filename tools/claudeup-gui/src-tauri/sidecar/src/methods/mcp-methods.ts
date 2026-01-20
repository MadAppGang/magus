/**
 * MCP Server RPC Methods
 * Implements MCP server management operations using claudeup-core services
 */

import { RpcMethodHandler, JSON_RPC_ERRORS } from '../types.js';
import {
  // MCP server listing and management
  getInstalledMcpServers,
  getEnabledMcpServers,
  addMcpServer,
  removeMcpServer,
  toggleMcpServer,
  // MCP server testing and status
  testMcpConnection,
  getMcpServerStatus,
  // MCP server environment variables
  getMcpServerEnvVars,
  setMcpServerEnvVar,
  removeMcpServerEnvVar,
  // Validation
  validateMcpServerName,
  validateMcpServerConfig,
  // Curated servers
  MCP_SERVERS,
  // MCP Registry API (online search)
  searchMcpRegistry,
  // Types
  type McpServerConfig,
} from '../../../../../claudeup-core/dist/index.js';

/**
 * Map core errors to JSON-RPC errors
 */
function mapCoreErrorToRpc(error: unknown): { code: number; message: string; data?: unknown } {
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'object' && error !== null) {
    errorMessage = JSON.stringify(error);
  } else {
    errorMessage = String(error);
  }

  // Validation errors
  if (errorMessage.includes('Invalid server name') || errorMessage.includes('Server name')) {
    return {
      code: JSON_RPC_ERRORS.VALIDATION_ERROR,
      message: 'Invalid MCP server name format',
      data: { originalError: errorMessage },
    };
  }

  if (errorMessage.includes('Invalid config') || errorMessage.includes('config')) {
    return {
      code: JSON_RPC_ERRORS.VALIDATION_ERROR,
      message: 'Invalid MCP server configuration',
      data: { originalError: errorMessage },
    };
  }

  if (errorMessage.includes('projectPath is required') || errorMessage.includes('Invalid project path')) {
    return {
      code: JSON_RPC_ERRORS.INVALID_PARAMS,
      message: 'projectPath is required and must be a valid absolute path',
      data: { originalError: errorMessage },
    };
  }

  // File not found
  if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
    return {
      code: JSON_RPC_ERRORS.FILE_NOT_FOUND,
      message: 'Required file or directory not found',
      data: { originalError: errorMessage },
    };
  }

  // Permission denied
  if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
    return {
      code: JSON_RPC_ERRORS.PERMISSION_DENIED,
      message: 'Permission denied',
      data: { originalError: errorMessage },
    };
  }

  // Network errors
  if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('timeout')) {
    return {
      code: JSON_RPC_ERRORS.NETWORK_ERROR,
      message: 'Network operation failed',
      data: { originalError: errorMessage },
    };
  }

  // Default: Internal error
  return {
    code: JSON_RPC_ERRORS.INTERNAL_ERROR,
    message: 'Internal server error',
    data: { originalError: errorMessage },
  };
}

/**
 * Create a simple logger callback that logs to stderr
 * MCP functions expect (message: string) => void, not LoggerCallback
 */
function createSimpleLogger(): (message: string) => void {
  return (message: string) => {
    console.error(message);
  };
}

/**
 * MCP method handlers
 */
export const mcpMethods: Record<string, RpcMethodHandler> = {
  /**
   * List all MCP servers
   * @param params.projectPath - Project path
   */
  'mcp.list': async (params: unknown) => {
    const { projectPath } = (params || {}) as { projectPath?: string };

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      const installedServers = await getInstalledMcpServers(projectPath);
      const enabledServers = await getEnabledMcpServers(projectPath);

      // Merge installed and enabled data, flatten config to top level
      const servers = Object.entries(installedServers).map(([name, config]) => ({
        name,
        command: config.command,
        args: config.args,
        env: config.env,
        enabled: enabledServers[name] || false,
        status: 'unknown', // Status will be fetched separately
      }));

      return { servers };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Add an MCP server
   * @param params.name - Server name
   * @param params.config - Server configuration
   * @param params.projectPath - Project path
   */
  'mcp.add': async (params: unknown) => {
    const { name, config, projectPath } = (params || {}) as {
      name?: string;
      config?: McpServerConfig;
      projectPath?: string;
    };

    if (!name || typeof name !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Server name is required and must be a string',
      };
    }

    if (!config || typeof config !== 'object') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Server config is required and must be an object',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      const logger = createSimpleLogger();

      // Validate name and config
      validateMcpServerName(name);
      validateMcpServerConfig(config);

      // Add server
      await addMcpServer(name, config, projectPath, logger);

      return { success: true, name };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Remove an MCP server
   * @param params.name - Server name
   * @param params.projectPath - Project path
   */
  'mcp.remove': async (params: unknown) => {
    const { name, projectPath } = (params || {}) as {
      name?: string;
      projectPath?: string;
    };

    if (!name || typeof name !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Server name is required and must be a string',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      const logger = createSimpleLogger();
      await removeMcpServer(name, projectPath, logger);

      return { success: true, name };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Toggle an MCP server enabled state
   * @param params.name - Server name
   * @param params.enabled - Target enabled state
   * @param params.projectPath - Project path
   */
  'mcp.toggle': async (params: unknown) => {
    const { name, enabled, projectPath } = (params || {}) as {
      name?: string;
      enabled?: boolean;
      projectPath?: string;
    };

    if (!name || typeof name !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Server name is required and must be a string',
      };
    }

    if (typeof enabled !== 'boolean') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'enabled is required and must be a boolean',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      const logger = createSimpleLogger();
      await toggleMcpServer(name, enabled, projectPath, logger);

      return { success: true, name, enabled };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Test MCP server connection
   * @param params.config - Server configuration
   */
  'mcp.testConnection': async (params: unknown) => {
    const { config } = (params || {}) as { config?: McpServerConfig };

    if (!config || typeof config !== 'object') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Server config is required and must be an object',
      };
    }

    try {
      const logger = createSimpleLogger();
      const result = await testMcpConnection(config, logger);

      return result;
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Get MCP server status
   * @param params.serverName - Server name
   * @param params.projectPath - Project path
   */
  'mcp.getStatus': async (params: unknown) => {
    const { serverName, projectPath } = (params || {}) as {
      serverName?: string;
      projectPath?: string;
    };

    if (!serverName || typeof serverName !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'serverName is required and must be a string',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      const status = await getMcpServerStatus(serverName, projectPath);

      return status;
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Get MCP server environment variables
   * @param params.serverName - Server name
   * @param params.projectPath - Project path
   */
  'mcp.getEnvVars': async (params: unknown) => {
    const { serverName, projectPath } = (params || {}) as {
      serverName?: string;
      projectPath?: string;
    };

    if (!serverName || typeof serverName !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'serverName is required and must be a string',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      const envVars = await getMcpServerEnvVars(serverName, projectPath);

      return { envVars };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Set MCP server environment variable
   * @param params.serverName - Server name
   * @param params.key - Environment variable key
   * @param params.value - Environment variable value
   * @param params.projectPath - Project path
   */
  'mcp.setEnvVar': async (params: unknown) => {
    const { serverName, key, value, projectPath } = (params || {}) as {
      serverName?: string;
      key?: string;
      value?: string;
      projectPath?: string;
    };

    if (!serverName || typeof serverName !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'serverName is required and must be a string',
      };
    }

    if (!key || typeof key !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'key is required and must be a string',
      };
    }

    if (!value || typeof value !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'value is required and must be a string',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      await setMcpServerEnvVar(serverName, key, value, projectPath);

      return { success: true };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Remove MCP server environment variable
   * @param params.serverName - Server name
   * @param params.key - Environment variable key
   * @param params.projectPath - Project path
   */
  'mcp.removeEnvVar': async (params: unknown) => {
    const { serverName, key, projectPath } = (params || {}) as {
      serverName?: string;
      key?: string;
      projectPath?: string;
    };

    if (!serverName || typeof serverName !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'serverName is required and must be a string',
      };
    }

    if (!key || typeof key !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'key is required and must be a string',
      };
    }

    if (!projectPath || typeof projectPath !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'projectPath is required and must be a string',
      };
    }

    try {
      await removeMcpServerEnvVar(serverName, key, projectPath);

      return { success: true };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Get curated MCP servers list
   */
  'mcp.getCurated': async () => {
    try {
      return { servers: MCP_SERVERS };
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },

  /**
   * Search MCP servers in the official registry
   * @param params.query - Search query
   * @param params.limit - Maximum number of results (default 20)
   * @param params.cursor - Pagination cursor
   */
  'mcp.searchRegistry': async (params: unknown) => {
    const { query, limit, cursor } = (params || {}) as {
      query?: string;
      limit?: number;
      cursor?: string;
    };

    try {
      const result = await searchMcpRegistry({
        query: query || '',
        limit: limit || 20,
        cursor,
      });

      return result;
    } catch (error) {
      throw mapCoreErrorToRpc(error);
    }
  },
};
