/**
 * File locking utilities for concurrent write protection
 *
 * Prevents race conditions when multiple processes modify settings files
 * Uses lock files for cross-platform compatibility
 */

import { open, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

/**
 * Maximum time to wait for a lock (milliseconds)
 */
const LOCK_TIMEOUT_MS = 10000;

/**
 * Lock retry interval (milliseconds)
 */
const LOCK_RETRY_INTERVAL_MS = 100;

/**
 * Acquire exclusive lock on file and execute operation
 * Uses lock files for cross-platform compatibility
 *
 * @param filePath - Path to file to lock
 * @param operation - Async operation to execute with lock held
 * @returns Result of the operation
 * @throws Error if lock cannot be acquired within timeout
 */
export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const lockDir = dirname(lockPath);

  // Ensure lock directory exists
  if (!existsSync(lockDir)) {
    await mkdir(lockDir, { recursive: true });
  }

  const startTime = Date.now();
  let fileHandle: FileHandle | null = null;

  // Try to acquire lock with retries
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      // Try to create lock file exclusively (fails if exists)
      fileHandle = await open(lockPath, 'wx');

      // Write PID to lock file for debugging
      await fileHandle.write(`${process.pid}\n${new Date().toISOString()}\n`);

      break;
    } catch (error: unknown) {
      // Lock file exists, retry after interval
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
        continue;
      }
      throw error;
    }
  }

  if (fileHandle === null) {
    throw new Error(
      `Failed to acquire lock on ${filePath} after ${LOCK_TIMEOUT_MS}ms. ` +
        `Another process may be holding the lock. Lock file: ${lockPath}`,
    );
  }

  try {
    // Execute operation with lock held
    return await operation();
  } finally {
    // Release lock
    try {
      await fileHandle.close();
      // Delete lock file
      const fs = await import('node:fs/promises');
      await fs.unlink(lockPath);
    } catch (error) {
      // Log error but don't throw - operation succeeded
      console.error(`Warning: Failed to release lock ${lockPath}:`, error);
    }
  }
}

/**
 * Check if file is currently locked
 *
 * @param filePath - Path to file to check
 * @returns True if lock file exists
 */
export function isFileLocked(filePath: string): boolean {
  const lockPath = `${filePath}.lock`;
  return existsSync(lockPath);
}

/**
 * Force remove lock file (use with caution)
 * Only use if you're certain the lock is stale
 *
 * @param filePath - Path to file whose lock to remove
 */
export async function forceRemoveLock(filePath: string): Promise<void> {
  const lockPath = `${filePath}.lock`;
  try {
    const fs = await import('node:fs/promises');
    await fs.unlink(lockPath);
  } catch (error: unknown) {
    // Ignore ENOENT (lock doesn't exist)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Get information about current lock
 *
 * @param filePath - Path to file to check
 * @returns Lock info or null if not locked
 */
export async function getLockInfo(
  filePath: string,
): Promise<{ pid: string; timestamp: string } | null> {
  const lockPath = `${filePath}.lock`;

  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(lockPath, 'utf-8');
    const [pid, timestamp] = content.trim().split('\n');
    return { pid, timestamp };
  } catch (error) {
    return null;
  }
}
