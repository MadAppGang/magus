/**
 * Input validation and sanitization utilities
 *
 * Security features:
 * - Path traversal prevention
 * - Plugin ID format validation
 * - Command allowlist enforcement
 * - Shell injection prevention
 * - Directory containment checks
 */

import { resolve, normalize } from 'node:path';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * Validate and sanitize project path
 * Prevents path traversal attacks by ensuring paths stay within allowed directories
 *
 * @param path - Path to validate
 * @returns Normalized absolute path
 * @throws Error if path is invalid or attempts traversal
 */
export function validateProjectPath(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid project path: path must be a non-empty string');
  }

  // Resolve to absolute path
  const absolutePath = resolve(path);

  // Ensure path doesn't escape expected directories
  const homePath = homedir();

  // Path must be under home directory or current directory
  if (!absolutePath.startsWith(homePath) && !absolutePath.startsWith(process.cwd())) {
    throw new Error(
      `Invalid project path: ${path} (path traversal detected - must be under home or current directory)`,
    );
  }

  // Canonicalize to prevent symlink attacks - resolve symlinks with realpathSync
  try {
    return realpathSync(absolutePath);
  } catch (error) {
    // If path doesn't exist yet, return normalized absolute path
    return normalize(absolutePath);
  }
}

/**
 * Validate plugin ID format
 * Expected format: "plugin-name@marketplace-name"
 *
 * @param pluginId - Plugin ID to validate
 * @throws Error if format is invalid
 */
export function validatePluginId(pluginId: string): void {
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error('Invalid plugin ID: must be a non-empty string');
  }

  // Format: "plugin-name@marketplace-name"
  // Allow alphanumeric, hyphens, underscores
  const regex = /^[a-z0-9_-]+@[a-z0-9_-]+$/i;

  if (!regex.test(pluginId)) {
    throw new Error(
      `Invalid plugin ID format: ${pluginId} (expected format: "plugin-name@marketplace-name")`,
    );
  }
}

/**
 * Validate command against allowlist
 * Prevents command injection by restricting to approved commands
 *
 * @param command - Command string to validate
 * @param allowedCommands - Array of allowed base commands
 * @throws Error if command is not in allowlist
 */
export function validateCommand(command: string, allowedCommands: string[]): void {
  if (!command || typeof command !== 'string') {
    throw new Error('Invalid command: must be a non-empty string');
  }

  if (!allowedCommands || !Array.isArray(allowedCommands)) {
    throw new Error('Invalid allowedCommands: must be an array');
  }

  // Extract base command (before arguments and pipes)
  const baseCommand = command.trim().split(/[\s|&;]/)[0];

  if (!baseCommand) {
    throw new Error('Invalid command: empty base command');
  }

  if (!allowedCommands.includes(baseCommand)) {
    throw new Error(
      `Command not allowed: ${baseCommand} (allowed commands: ${allowedCommands.join(', ')})`,
    );
  }
}

/**
 * Sanitize environment variable value
 * Prevents shell injection via environment variables
 *
 * @param value - Environment variable value to sanitize
 * @returns Sanitized value with shell metacharacters removed
 */
export function sanitizeEnvValue(value: string): string {
  if (typeof value !== 'string') {
    return '';
  }

  // Remove shell metacharacters that could be used for injection
  // Preserves: alphanumeric, spaces, hyphens, underscores, dots, slashes, colons
  return value.replace(/[;|&$`<>(){}[\]\\'"!*?~]/g, '');
}

/**
 * Validate file path is within allowed directory
 * Ensures file operations stay within project boundaries
 *
 * @param filePath - File path to validate
 * @param allowedDir - Directory that must contain the file
 * @returns Normalized absolute path
 * @throws Error if path is outside allowed directory
 */
export function validateFilePath(filePath: string, allowedDir: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path: path must be a non-empty string');
  }

  if (!allowedDir || typeof allowedDir !== 'string') {
    throw new Error('Invalid allowed directory: must be a non-empty string');
  }

  const absolutePath = resolve(filePath);
  const allowedPath = resolve(allowedDir);

  if (!absolutePath.startsWith(allowedPath)) {
    throw new Error(
      `File path not allowed: ${filePath} (must be within ${allowedDir})`,
    );
  }

  return absolutePath;
}

/**
 * Validate tool name for installation
 * Ensures tool names don't contain shell metacharacters
 *
 * @param name - Tool name to validate
 * @throws Error if name contains invalid characters
 */
export function validateToolName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid tool name: must be a non-empty string');
  }

  // Allow alphanumeric, hyphens, underscores, slashes (for scoped packages)
  const regex = /^[@a-z0-9/_-]+$/i;

  if (!regex.test(name)) {
    throw new Error(
      `Invalid tool name: ${name} (only alphanumeric, hyphens, underscores, and slashes allowed)`,
    );
  }
}

/**
 * Allowlisted package managers for tool installation
 */
export const ALLOWED_PACKAGE_MANAGERS = ['npm', 'npx', 'bun', 'bunx', 'pip', 'pipx', 'brew'];

/**
 * Validate package manager against allowlist
 *
 * @param packageManager - Package manager command to validate
 * @throws Error if package manager is not allowed
 */
export function validatePackageManager(packageManager: string): void {
  validateCommand(packageManager, ALLOWED_PACKAGE_MANAGERS);
}
