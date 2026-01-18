/**
 * Marketplace RPC Methods
 * Implements marketplace management operations using claudeup-core services
 */

import { RpcMethodHandler, ProgressParams, JSON_RPC_ERRORS } from '../types.js';
import {
  // Marketplace operations
  cloneMarketplace,
  deleteMarketplace,
  addToKnownMarketplaces,
  removeFromKnownMarketplaces,
  scanLocalMarketplaces,
  // Settings management
  addGlobalMarketplace,
  removeGlobalMarketplace,
  getGlobalConfiguredMarketplaces,
  // Types
  type MarketplaceSource,
  type Marketplace,
} from '../../../../../claudeup-core/dist/index.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Logger callback type for claudeup-core functions
 */
type LoggerCallback = (level: 'info' | 'warn' | 'error', message: string) => void;

/**
 * Default marketplaces that cannot be removed
 */
const DEFAULT_MARKETPLACES = ['claude-plugins-official', 'mag-claude-plugins'];

/**
 * Paths for marketplace storage
 */
const MARKETPLACES_DIR = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
const KNOWN_MARKETPLACES_FILE = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json');

/**
 * Write to stdout - always use process.stdout for compatibility
 */
function writeOutput(data: string): void {
  const output = data + '\n';
  process.stdout.write(output);
}

/**
 * Emit a progress notification via stdout (JSON-RPC 2.0 notification)
 */
function emitProgress(operation: string, percent: number, status: string, cancellable = false): void {
  const notification = {
    jsonrpc: '2.0',
    method: 'progress',
    params: {
      operation,
      percent,
      status,
      cancellable,
    } as ProgressParams,
  };
  writeOutput(JSON.stringify(notification));
}

/**
 * Create a logger callback that emits progress notifications
 */
function createLogger(operationId: string): LoggerCallback {
  return (level: 'info' | 'warn' | 'error', message: string) => {
    // Only emit info level as progress, warn/error go to stderr
    if (level === 'info') {
      emitProgress(operationId, -1, message, false);
    } else {
      console.error(`[${level}] ${message}`);
    }
  };
}

/**
 * Validate Git URL format
 */
function validateGitUrl(url: string): { valid: boolean; error?: string } {
  const cleaned = url.trim();

  // Allow GitHub HTTPS
  if (/^https:\/\/github\.com\/[\w-]+\/[\w.-]+/.test(cleaned)) {
    return { valid: true };
  }

  // Allow GitLab HTTPS
  if (/^https:\/\/gitlab\.com\/[\w-]+\/[\w.-]+/.test(cleaned)) {
    return { valid: true };
  }

  // Allow GitHub SSH
  if (/^git@github\.com:[\w-]+\/[\w.-]+\.git$/.test(cleaned)) {
    return { valid: true };
  }

  // Allow GitLab SSH
  if (/^git@gitlab\.com:[\w-]+\/[\w.-]+\.git$/.test(cleaned)) {
    return { valid: true };
  }

  return { valid: false, error: 'Invalid Git URL format. Use https://github.com/owner/repo or git@github.com:owner/repo.git' };
}

/**
 * Check if marketplace is a default marketplace
 */
function isDefaultMarketplace(name: string): boolean {
  return DEFAULT_MARKETPLACES.includes(name);
}

/**
 * Map marketplace errors to JSON-RPC errors
 */
function mapMarketplaceErrorToRpc(error: unknown): { code: number; message: string; data?: unknown } {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Already exists
  if (errorMessage.includes('already exists') || errorMessage.includes('already cloned')) {
    return {
      code: JSON_RPC_ERRORS.VALIDATION_ERROR,
      message: 'Marketplace already exists',
      data: { originalError: errorMessage },
    };
  }

  // Invalid URL
  if (errorMessage.includes('Invalid repo format') || errorMessage.includes('Invalid Git URL')) {
    return {
      code: JSON_RPC_ERRORS.VALIDATION_ERROR,
      message: 'Invalid Git URL format',
      data: { originalError: errorMessage },
    };
  }

  // Not a valid marketplace
  if (errorMessage.includes('Not a valid marketplace') || errorMessage.includes('no manifest found') || errorMessage.includes('marketplace.json')) {
    return {
      code: JSON_RPC_ERRORS.VALIDATION_ERROR,
      message: 'Repository does not contain a valid marketplace manifest (.claude-plugin/marketplace.json)',
      data: { originalError: errorMessage },
    };
  }

  // Default marketplace removal attempt
  if (errorMessage.includes('Cannot remove default')) {
    return {
      code: JSON_RPC_ERRORS.VALIDATION_ERROR,
      message: 'Cannot remove default marketplaces (claude-plugins-official, mag-claude-plugins)',
      data: { originalError: errorMessage },
    };
  }

  // Not found
  if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
    return {
      code: JSON_RPC_ERRORS.FILE_NOT_FOUND,
      message: 'Marketplace not found',
      data: { originalError: errorMessage },
    };
  }

  // Network errors
  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('fetch') || errorMessage.includes('git clone')) {
    return {
      code: JSON_RPC_ERRORS.NETWORK_ERROR,
      message: 'Network error: Clone failed. Check internet connection and repository access.',
      data: { originalError: errorMessage },
    };
  }

  // Permission errors
  if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
    return {
      code: JSON_RPC_ERRORS.PERMISSION_DENIED,
      message: 'Permission denied',
      data: { originalError: errorMessage },
    };
  }

  // Default
  return {
    code: JSON_RPC_ERRORS.INTERNAL_ERROR,
    message: 'Marketplace operation failed',
    data: { originalError: errorMessage },
  };
}

/**
 * Marketplace method handlers
 */
export const marketplaceMethods: Record<string, RpcMethodHandler> = {
  /**
   * Add a custom marketplace by cloning from Git URL
   * @param params.url - Git URL (https or ssh)
   * @param params.operationId - Optional operation ID for progress tracking
   */
  'marketplace.add': async (params: unknown) => {
    const { url, operationId } = (params || {}) as {
      url?: string;
      operationId?: string;
    };

    // Validate URL parameter
    if (!url || typeof url !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'URL is required and must be a string',
      };
    }

    // Validate URL format
    const validation = validateGitUrl(url);
    if (!validation.valid) {
      throw {
        code: JSON_RPC_ERRORS.VALIDATION_ERROR,
        message: validation.error || 'Invalid Git URL',
      };
    }

    const opId = operationId || `add-marketplace-${Date.now()}`;
    const logger = createLogger(opId);

    let clonedName: string | undefined;

    try {
      emitProgress(opId, 0, 'Validating URL...', true);

      // Clone marketplace
      emitProgress(opId, 25, 'Cloning repository...', true);

      const cloneResult = await cloneMarketplace(
        MARKETPLACES_DIR,
        url,
        (stage: string) => {
          emitProgress(opId, 50, `Cloning: ${stage}`, true);
        }
      );

      if (!cloneResult.success) {
        throw new Error(cloneResult.error || 'Clone failed');
      }

      clonedName = cloneResult.name;

      // Validate manifest exists
      emitProgress(opId, 60, 'Validating marketplace manifest...', true);

      const manifestPath = path.join(MARKETPLACES_DIR, clonedName!, '.claude-plugin', 'marketplace.json');
      const manifestExists = existsSync(manifestPath);

      if (!manifestExists) {
        throw new Error('Not a valid marketplace: no manifest found at .claude-plugin/marketplace.json');
      }

      // Read and validate manifest schema
      try {
        const manifestContent = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        if (!manifestContent.name || !manifestContent.plugins) {
          throw new Error('Invalid manifest: missing required fields (name, plugins)');
        }
      } catch (manifestError) {
        throw new Error(`Invalid manifest: ${manifestError instanceof Error ? manifestError.message : String(manifestError)}`);
      }

      // Add to global settings
      emitProgress(opId, 75, 'Updating settings...', true);

      const marketplace: Marketplace = {
        name: clonedName!,
        displayName: cloneResult.displayName || clonedName!,
        source: {
          source: url.includes('github.com') ? 'github' : 'directory',
          repo: cloneResult.repo || url,
        },
      };

      await addGlobalMarketplace(marketplace, logger);

      // Add to known marketplaces
      emitProgress(opId, 90, 'Registering marketplace...', true);

      await addToKnownMarketplaces(
        KNOWN_MARKETPLACES_FILE,
        MARKETPLACES_DIR,
        clonedName!,
        cloneResult.repo || url
      );

      emitProgress(opId, 100, 'Marketplace added successfully', false);

      return {
        success: true,
        name: clonedName,
        displayName: cloneResult.displayName || clonedName,
      };
    } catch (error: unknown) {
      // Cleanup on error: delete cloned directory if it exists
      if (clonedName) {
        try {
          const clonedPath = path.join(MARKETPLACES_DIR, clonedName);
          if (existsSync(clonedPath)) {
            await fs.rm(clonedPath, { recursive: true, force: true });
            logger('info', `Cleaned up failed clone at ${clonedPath}`);
          }
        } catch (cleanupError) {
          logger('error', `Failed to cleanup: ${cleanupError}`);
        }
      }

      // If error is already an RPC error, re-throw
      if (error && typeof error === 'object' && 'code' in error) {
        emitProgress(opId, 0, `Failed: ${(error as { message?: string }).message || 'Unknown error'}`, false);
        throw error;
      }

      const rpcError = mapMarketplaceErrorToRpc(error);
      emitProgress(opId, 0, `Failed: ${rpcError.message}`, false);
      throw rpcError;
    }
  },

  /**
   * Remove a custom marketplace
   * @param params.name - Marketplace name
   */
  'marketplace.remove': async (params: unknown) => {
    const { name } = (params || {}) as {
      name?: string;
    };

    // Validate name parameter
    if (!name || typeof name !== 'string') {
      throw {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: 'Marketplace name is required and must be a string',
      };
    }

    // Validate not a default marketplace
    if (isDefaultMarketplace(name)) {
      throw {
        code: JSON_RPC_ERRORS.VALIDATION_ERROR,
        message: 'Cannot remove default marketplaces (claude-plugins-official, mag-claude-plugins)',
      };
    }

    const logger = (level: 'info' | 'warn' | 'error', message: string): void => {
      console.error(`[${level}] ${message}`);
    };

    try {
      // Remove from global settings
      await removeGlobalMarketplace(name, logger);

      // Delete local cache
      await deleteMarketplace(MARKETPLACES_DIR, name);

      // Remove from known marketplaces
      await removeFromKnownMarketplaces(KNOWN_MARKETPLACES_FILE, name);

      return {
        success: true,
        name,
      };
    } catch (error: unknown) {
      // If error is already an RPC error, re-throw
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }

      const rpcError = mapMarketplaceErrorToRpc(error);
      throw rpcError;
    }
  },

  /**
   * List all marketplaces (global only)
   */
  'marketplace.list': async () => {
    const logger = (level: 'info' | 'warn' | 'error', message: string): void => {
      process.stderr.write(`[marketplace.list][${level}] ${message}\n`);
    };

    try {
      process.stderr.write('[marketplace.list] Starting...\n');

      // Get configured marketplaces from settings (extra custom ones)
      process.stderr.write('[marketplace.list] Getting configured marketplaces...\n');
      const configuredMarketplaces = await getGlobalConfiguredMarketplaces();
      process.stderr.write(`[marketplace.list] Got ${Object.keys(configuredMarketplaces).length} configured marketplaces\n`);

      // Scan local marketplaces for plugin counts
      process.stderr.write('[marketplace.list] Scanning local marketplaces...\n');
      let localMarketplaces: Map<string, any>;
      try {
        localMarketplaces = await scanLocalMarketplaces(
          MARKETPLACES_DIR,
          KNOWN_MARKETPLACES_FILE,
          logger
        );
        process.stderr.write(`[marketplace.list] Scanned ${localMarketplaces.size} local marketplaces\n`);
      } catch (scanError) {
        process.stderr.write(`[marketplace.list] scanLocalMarketplaces error: ${scanError}\n`);
        // Return empty map on scan error to avoid crash
        localMarketplaces = new Map();
      }

      // Build result array with proper typing
      interface MarketplaceInfo {
        id: string;
        name: string;
        count: string;
        icon: string;
        isDefault: boolean;
        source?: MarketplaceSource;
      }

      const marketplaces: MarketplaceInfo[] = [];

      // Add default marketplaces first (hardcoded)
      const defaultMarketplacesInfo: Array<{ id: string; name: string }> = [
        { id: 'claude-plugins-official', name: 'Claude Official' },
        { id: 'mag-claude-plugins', name: 'MAG Claude Plugins' },
      ];

      for (const defaultMkt of defaultMarketplacesInfo) {
        const localData = localMarketplaces.get(defaultMkt.id);
        const pluginCount = localData?.plugins?.length ?? 0;

        marketplaces.push({
          id: defaultMkt.id,
          name: defaultMkt.name,
          count: pluginCount > 0
            ? `${pluginCount} plugin${pluginCount !== 1 ? 's' : ''}`
            : '0 plugins',
          icon: defaultMkt.id === 'claude-plugins-official' ? 'shield' : 'zap',
          isDefault: true,
        });
      }

      // Add custom marketplaces from settings
      for (const [id, source] of Object.entries(configuredMarketplaces)) {
        // Skip if already added as default
        if (isDefaultMarketplace(id)) continue;

        const localData = localMarketplaces.get(id);
        const pluginCount = localData?.plugins?.length ?? 0;

        marketplaces.push({
          id,
          name: localData?.name || id, // Use name from manifest or fallback to id
          count: pluginCount > 0
            ? `${pluginCount} plugin${pluginCount !== 1 ? 's' : ''}`
            : '0 plugins',
          icon: 'globe',
          isDefault: false,
          source,
        });
      }

      return {
        marketplaces,
      };
    } catch (error: unknown) {
      // If error is already an RPC error, re-throw
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }

      const rpcError = mapMarketplaceErrorToRpc(error);
      throw rpcError;
    }
  },
};
