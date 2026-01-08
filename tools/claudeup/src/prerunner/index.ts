import { UpdateCache } from '../services/update-cache.js';
import { refreshLocalMarketplaces } from '../services/local-marketplace.js';
import { getAvailablePlugins, clearMarketplaceCache } from '../services/plugin-manager.js';
import { runClaude } from '../services/claude-runner.js';

/**
 * Prerun orchestration: Check for updates, apply them, then run claude
 * @param claudeArgs - Arguments to pass to claude CLI
 * @returns Exit code from claude process
 */
export async function prerunClaude(claudeArgs: string[]): Promise<number> {
  const cache = new UpdateCache();

  try {
    // STEP 1: Check if we should update (time-based cache)
    const shouldUpdate = await cache.shouldCheckForUpdates();

    if (shouldUpdate) {
      // STEP 2: Refresh all marketplaces (git pull)
      const refreshResults = await refreshLocalMarketplaces();

      // STEP 3: Clear cache to force fresh plugin info
      clearMarketplaceCache();

      // STEP 4: Get updated plugin info (to detect versions)
      const plugins = await getAvailablePlugins();

      // STEP 5: Build summary - show all updated plugins (not just enabled)
      const updatedMarketplaces: string[] = [];
      const updatedPlugins: string[] = [];
      const failed: string[] = [];

      for (const result of refreshResults) {
        if (result.success && result.updated) {
          updatedMarketplaces.push(result.name);
          // Find ALL plugins from this marketplace (regardless of enabled state)
          const mpPlugins = plugins.filter(p => p.marketplace === result.name);
          if (mpPlugins.length > 0) {
            updatedPlugins.push(...mpPlugins.map(p => `${p.name} v${p.version}`));
          }
        } else if (!result.success) {
          failed.push(`${result.name}${result.error ? ` (${result.error})` : ''}`);
        }
      }

      // STEP 6: Save cache
      await cache.saveCheck({
        lastUpdateCheck: new Date().toISOString(),
        lastUpdateResult: { updated: updatedPlugins, failed },
      });

      // STEP 7: Display summary (marketplace-level and plugin-level)
      if (updatedMarketplaces.length > 0) {
        console.log(`✓ Updated marketplace(s): ${updatedMarketplaces.join(', ')}`);
        if (updatedPlugins.length > 0) {
          console.log(`  Plugins: ${updatedPlugins.join(', ')}`);
        }
      }
      if (failed.length > 0) {
        console.warn(`⚠ Failed to update: ${failed.join(', ')}`);
      }
    }
    // If !shouldUpdate → silent (no output)

  } catch (error) {
    // Non-fatal errors - warn and continue
    console.warn('Warning: Plugin update check failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  // STEP 8: Always run claude (even if update failed)
  return runClaude(claudeArgs);
}
