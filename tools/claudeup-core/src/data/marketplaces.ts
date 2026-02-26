/**
 * Default marketplace definitions
 * Used by plugin-manager to fetch available plugins
 */

export interface MarketplaceSource {
  source: 'github' | 'directory';
  repo?: string;
  path?: string;
}

export interface DefaultMarketplace {
  name: string;
  displayName: string;
  description: string;
  source: MarketplaceSource;
  official?: boolean;
  featured?: boolean;
}

/**
 * Default marketplaces - official and featured sources
 */
export const defaultMarketplaces: DefaultMarketplace[] = [
  {
    name: 'magus',
    displayName: 'Magus',
    description: 'Professional plugin marketplace with Frontend, Code Analysis, Orchestration, and more',
    source: {
      source: 'github',
      repo: 'MadAppGang/claude-code',
    },
    official: true,
    featured: true,
  },
  {
    name: 'claude-plugins-official',
    displayName: 'Claude Official',
    description: 'Official and external Claude Code plugins from Anthropic',
    source: {
      source: 'github',
      repo: 'anthropics/claude-plugins-official',
    },
    official: true,
    featured: true,
  },
];

// Legacy export for compatibility
export interface Marketplace {
  name: string;
  url: string;
  description: string;
  owner: string;
  category: "official" | "community" | "personal";
  featured?: boolean;
}

export const MARKETPLACES: Marketplace[] = [
  {
    name: "Magus",
    url: "https://github.com/MadAppGang/claude-code",
    description: "Professional plugin marketplace with Frontend, Code Analysis, Orchestration, and more",
    owner: "MadAppGang",
    category: "official",
    featured: true,
  },
  {
    name: "Anthropic Official",
    url: "https://github.com/anthropics/claude-code-plugins",
    description: "Official Claude Code plugins from Anthropic",
    owner: "Anthropic",
    category: "official",
    featured: true,
  },
];
