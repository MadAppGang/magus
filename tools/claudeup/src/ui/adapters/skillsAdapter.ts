import type { SkillInfo } from "../../types/index.js";

// ─── Item types ───────────────────────────────────────────────────────────────

export interface SkillCategoryItem {
  id: string;
  kind: "category";
  label: string;
  title: string;
  categoryKey: string;
  count?: number;
  tone: "purple" | "green" | "teal" | "yellow" | "gray" | "red";
  badge?: string;
  star?: string;
}

export interface SkillSkillItem {
  id: string;
  kind: "skill";
  label: string;
  skill: SkillInfo;
}

export type SkillBrowserItem = SkillCategoryItem | SkillSkillItem;

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface BuildSkillBrowserItemsArgs {
  recommended: SkillInfo[];
  popular: SkillInfo[];
  installed: SkillInfo[];
  searchResults: SkillInfo[];
  query: string;
  isSearchLoading: boolean;
}

/**
 * Builds the flat list of items for the SkillsScreen list panel.
 * Extracted from SkillsScreen so it can be tested independently.
 */
export function buildSkillBrowserItems({
  recommended,
  popular,
  installed,
  searchResults,
  query,
  isSearchLoading,
}: BuildSkillBrowserItemsArgs): SkillBrowserItem[] {
  const lowerQuery = query.toLowerCase();
  const items: SkillBrowserItem[] = [];

  // ── INSTALLED: always shown at top (if any) ──
  const installedFiltered = lowerQuery
    ? installed.filter((s) => s.name.toLowerCase().includes(lowerQuery))
    : installed;

  if (installedFiltered.length > 0) {
    items.push({
      id: "cat:installed",
      kind: "category",
      label: `Installed (${installedFiltered.length})`,
      title: "Installed",
      categoryKey: "installed",
      count: installedFiltered.length,
      tone: "purple",
      star: "● ",
    });
    for (const skill of installedFiltered) {
      items.push({
        id: `skill:${skill.id}`,
        kind: "skill",
        label: skill.name,
        skill,
      });
    }
  }

  // ── RECOMMENDED: always shown, filtered when searching ──
  const filteredRec = lowerQuery
    ? recommended.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerQuery) ||
          (s.description || "").toLowerCase().includes(lowerQuery),
      )
    : recommended;

  items.push({
    id: "cat:recommended",
    kind: "category",
    label: "Recommended",
    title: "Recommended",
    categoryKey: "recommended",
    count: filteredRec.length,
    tone: "green",
    star: "★ ",
  });
  for (const skill of filteredRec) {
    items.push({
      id: `skill:${skill.id}`,
      kind: "skill",
      label: skill.name,
      skill,
    });
  }

  // ── SEARCH MODE ──
  if (query.length >= 2) {
    if (!isSearchLoading && searchResults.length > 0) {
      const recNames = new Set(recommended.map((s) => s.name));
      const deduped = searchResults
        .filter((s) => !recNames.has(s.name))
        .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));

      if (deduped.length > 0) {
        items.push({
          id: "cat:search",
          kind: "category",
          label: `Search (${deduped.length})`,
          title: "Search",
          categoryKey: "popular",
          count: deduped.length,
          tone: "teal",
        });
        for (const skill of deduped) {
          items.push({
            id: `skill:${skill.id}`,
            kind: "skill",
            label: skill.name,
            skill,
          });
        }
      }
    }
    return items;
  }

  // ── POPULAR (default, no search query) ──
  if (popular.length > 0) {
    items.push({
      id: "cat:popular",
      kind: "category",
      label: "Popular",
      title: "Popular",
      categoryKey: "popular",
      count: popular.length,
      tone: "teal",
    });
    for (const skill of popular) {
      items.push({
        id: `skill:${skill.id}`,
        kind: "skill",
        label: skill.name,
        skill,
      });
    }
  }

  return items;
}
