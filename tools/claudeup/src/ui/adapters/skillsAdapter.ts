import type { SkillInfo, SkillSetInfo } from "../../types/index.js";

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
  /** Extra indent level for child skills inside an expanded skill set */
  indent?: number;
}

export interface SkillSetItem {
  id: string;
  kind: "skillset";
  label: string;
  skillSet: SkillSetInfo;
  expanded: boolean;
}

export type SkillBrowserItem = SkillCategoryItem | SkillSkillItem | SkillSetItem;

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface BuildSkillBrowserItemsArgs {
  recommended: SkillInfo[];
  popular: SkillInfo[];
  installed: SkillInfo[];
  searchResults: SkillInfo[];
  query: string;
  isSearchLoading: boolean;
  skillSets?: SkillSetInfo[];
  expandedSets?: Set<string>;
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
  skillSets = [],
  expandedSets = new Set(),
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
      star: "\u25CF ",
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

  // ── RECOMMENDED: skill sets + individual skills, all as first-class items ──
  const filteredSets = lowerQuery
    ? skillSets.filter((s) => {
        if (s.name.toLowerCase().includes(lowerQuery)) return true;
        if (s.description.toLowerCase().includes(lowerQuery)) return true;
        if (s.loaded && s.skills.some((sk) => sk.name.toLowerCase().includes(lowerQuery))) return true;
        return false;
      })
    : skillSets;

  const filteredRec = lowerQuery
    ? recommended.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerQuery) ||
          (s.description || "").toLowerCase().includes(lowerQuery),
      )
    : recommended;

  const recommendedCount = filteredSets.length + filteredRec.length;

  items.push({
    id: "cat:recommended",
    kind: "category",
    label: "Recommended",
    title: "Recommended",
    categoryKey: "recommended",
    count: recommendedCount,
    tone: "green",
    star: "\u2605 ",
  });

  // Skill sets first within recommended
  for (const set of filteredSets) {
    const isExpanded = expandedSets.has(set.id);
    items.push({
      id: `skillset:${set.id}`,
      kind: "skillset",
      label: set.name,
      skillSet: set,
      expanded: isExpanded,
    });
    // When expanded, show child skills as indented skill items
    if (isExpanded && set.loaded) {
      const childSkills = lowerQuery
        ? set.skills.filter((sk) => sk.name.toLowerCase().includes(lowerQuery))
        : set.skills;
      for (const skill of childSkills) {
        items.push({
          id: `skill:${skill.id}`,
          kind: "skill",
          label: skill.name,
          skill,
          indent: 2,
        });
      }
    }
  }

  // Then individual recommended skills
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

  // ── POPULAR (default, no search query) — only skills with meaningful stars ──
  // Dedup by name — API can return same skill name from different repos
  const seenPopular = new Set<string>();
  const popularDeduped = popular
    .filter((s) => (s.stars ?? 0) >= 5)
    .filter((s) => {
      if (seenPopular.has(s.name)) return false;
      seenPopular.add(s.name);
      return true;
    });
  if (popularDeduped.length > 0) {
    items.push({
      id: "cat:popular",
      kind: "category",
      label: "Popular",
      title: "Popular",
      categoryKey: "popular",
      count: popularDeduped.length,
      tone: "teal",
    });
    for (const skill of popularDeduped) {
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
