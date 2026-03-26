import type { Marketplace } from "../../types/index.js";
import type { PluginInfo } from "../../services/plugin-manager.js";

// Virtual marketplace name for the community sub-section of claude-plugins-official
export const COMMUNITY_VIRTUAL_MARKETPLACE = "claude-plugins-official:community";
// The marketplace that gets split into Anthropic Official + Community sections
export const SPLIT_MARKETPLACE = "claude-plugins-official";

// ─── Item types ───────────────────────────────────────────────────────────────

export interface PluginCategoryItem {
  id: string;
  kind: "category";
  label: string;
  marketplace: Marketplace;
  marketplaceEnabled: boolean;
  pluginCount: number;
  isExpanded: boolean;
  isCommunitySection?: boolean;
  /** Visual tone for the category row */
  tone: "yellow" | "gray" | "green" | "red" | "purple" | "teal";
  /** Badge text shown on category row (e.g. "★ Official") */
  badge?: string;
}

export interface PluginPluginItem {
  id: string;
  kind: "plugin";
  label: string;
  plugin: PluginInfo;
  /** Fuzzy match highlight indices, if search is active */
  matches?: number[];
}

export type PluginBrowserItem = PluginCategoryItem | PluginPluginItem;

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface BuildPluginBrowserItemsArgs {
  marketplaces: Marketplace[];
  plugins: PluginInfo[];
  collapsedMarketplaces: Set<string>;
}

/**
 * Derives tone and badge for a category item based on marketplace identity.
 */
function categoryStyling(
  mp: Marketplace,
  isCommunitySection: boolean,
  marketplaceEnabled: boolean,
): { tone: PluginCategoryItem["tone"]; badge?: string } {
  if (!marketplaceEnabled) {
    return { tone: "gray" };
  }
  if (isCommunitySection) {
    return { tone: "gray", badge: "3rd Party" };
  }
  if (mp.name === "claude-plugins-official") {
    return { tone: "yellow", badge: "★ Official" };
  }
  if (mp.name === "claude-code-plugins") {
    return { tone: "red", badge: "⚠ Deprecated" };
  }
  if (mp.official) {
    return { tone: "yellow", badge: "★ Official" };
  }
  return { tone: "green", badge: "✓ Added" };
}

/**
 * Builds the flat list of items for the PluginsScreen list panel.
 * Extracted from PluginsScreen so it can be tested independently.
 */
export function buildPluginBrowserItems({
  marketplaces,
  plugins,
  collapsedMarketplaces,
}: BuildPluginBrowserItemsArgs): PluginBrowserItem[] {
  const pluginsByMarketplace = new Map<string, PluginInfo[]>();
  for (const plugin of plugins) {
    const existing = pluginsByMarketplace.get(plugin.marketplace) || [];
    existing.push(plugin);
    pluginsByMarketplace.set(plugin.marketplace, existing);
  }

  // Sort marketplaces: deprecated ones go to the bottom
  const sortedMarketplaces = [...marketplaces].sort((a, b) => {
    const aDeprecated = a.name === "claude-code-plugins" ? 1 : 0;
    const bDeprecated = b.name === "claude-code-plugins" ? 1 : 0;
    return aDeprecated - bDeprecated;
  });

  const items: PluginBrowserItem[] = [];

  for (const marketplace of sortedMarketplaces) {
    const marketplacePlugins = pluginsByMarketplace.get(marketplace.name) || [];
    const isCollapsed = collapsedMarketplaces.has(marketplace.name);
    const isEnabled = marketplacePlugins.length > 0 || !!marketplace.official;
    const hasPlugins = marketplacePlugins.length > 0;

    // Special handling: split claude-plugins-official into two sub-sections
    if (marketplace.name === SPLIT_MARKETPLACE && hasPlugins) {
      const anthropicPlugins = marketplacePlugins.filter(
        (p) => p.author?.name?.toLowerCase() === "anthropic",
      );
      const communityPlugins = marketplacePlugins.filter(
        (p) => p.author?.name?.toLowerCase() !== "anthropic",
      );

      // Sub-section 1: Anthropic Official (plugins by Anthropic)
      const anthropicCollapsed = collapsedMarketplaces.has(marketplace.name);
      const anthropicHasPlugins = anthropicPlugins.length > 0;
      const anthropicStyle = categoryStyling(marketplace, false, isEnabled);
      items.push({
        id: `mp:${marketplace.name}`,
        kind: "category",
        label: marketplace.displayName,
        marketplace,
        marketplaceEnabled: isEnabled,
        pluginCount: anthropicPlugins.length,
        isExpanded: !anthropicCollapsed && anthropicHasPlugins,
        tone: anthropicStyle.tone,
        badge: anthropicStyle.badge,
      });
      if (isEnabled && anthropicHasPlugins && !anthropicCollapsed) {
        for (const plugin of anthropicPlugins) {
          items.push({
            id: `pl:${plugin.id}`,
            kind: "plugin",
            label: plugin.name,
            plugin,
          });
        }
      }

      // Sub-section 2: Community (third-party plugins in same marketplace)
      if (communityPlugins.length > 0) {
        const communityVirtualMp: Marketplace = {
          name: COMMUNITY_VIRTUAL_MARKETPLACE,
          displayName: "Anthropic Official — 3rd Party",
          source: marketplace.source,
          description: "Third-party plugins in the Anthropic Official marketplace",
        };
        const communityCollapsed = collapsedMarketplaces.has(COMMUNITY_VIRTUAL_MARKETPLACE);
        const communityStyle = categoryStyling(communityVirtualMp, true, true);
        items.push({
          id: `mp:${COMMUNITY_VIRTUAL_MARKETPLACE}`,
          kind: "category",
          label: "Anthropic Official — 3rd Party",
          marketplace: communityVirtualMp,
          marketplaceEnabled: true,
          pluginCount: communityPlugins.length,
          isExpanded: !communityCollapsed,
          isCommunitySection: true,
          tone: communityStyle.tone,
          badge: communityStyle.badge,
        });
        if (!communityCollapsed) {
          for (const plugin of communityPlugins) {
            items.push({
              id: `pl:${plugin.id}`,
              kind: "plugin",
              label: plugin.name,
              plugin,
            });
          }
        }
      }

      continue;
    }

    // Category header (marketplace)
    const style = categoryStyling(marketplace, false, isEnabled);
    items.push({
      id: `mp:${marketplace.name}`,
      kind: "category",
      label: marketplace.displayName,
      marketplace,
      marketplaceEnabled: isEnabled,
      pluginCount: marketplacePlugins.length,
      isExpanded: !isCollapsed && hasPlugins,
      tone: style.tone,
      badge: style.badge,
    });

    // Plugins under this marketplace (if expanded)
    if (isEnabled && hasPlugins && !isCollapsed) {
      for (const plugin of marketplacePlugins) {
        items.push({
          id: `pl:${plugin.id}`,
          kind: "plugin",
          label: plugin.name,
          plugin,
        });
      }
    }
  }

  return items;
}
