export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Parse plugin ID in format "plugin-name@marketplace-name"
 * @returns Object with pluginName and marketplace, or null if invalid
 */
export function parsePluginId(pluginId: string): { pluginName: string; marketplace: string } | null {
  if (!pluginId || typeof pluginId !== 'string') {
    return null;
  }
  const atIndex = pluginId.lastIndexOf('@');
  if (atIndex === -1 || atIndex === 0 || atIndex === pluginId.length - 1) {
    return null;
  }
  return {
    pluginName: pluginId.slice(0, atIndex),
    marketplace: pluginId.slice(atIndex + 1),
  };
}

/**
 * Format marketplace name for display
 * Converts slugs to title case
 */
export function formatMarketplaceName(name: string): string {
  if (!name) return name;
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Validate GitHub repository format (owner/repo)
 */
export function isValidGitHubRepo(repo: string): boolean {
  if (!repo || typeof repo !== 'string') {
    return false;
  }
  const parts = repo.split('/');
  if (parts.length !== 2) {
    return false;
  }
  const [owner, repoName] = parts;
  // Basic validation: no empty parts, no special characters except hyphen/underscore
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return (
    owner.length > 0 &&
    repoName.length > 0 &&
    validPattern.test(owner) &&
    validPattern.test(repoName)
  );
}

export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) {
    return singular;
  }
  return plural || `${singular}s`;
}

export function formatList(items: string[], conjunction = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;

  const allButLast = items.slice(0, -1).join(", ");
  const last = items[items.length - 1];
  return `${allButLast}, ${conjunction} ${last}`;
}

export function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9.-]/gi, "_");
}

export function parseJsonSafe<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
