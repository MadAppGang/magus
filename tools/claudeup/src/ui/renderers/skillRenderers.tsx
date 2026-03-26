import React from "react";
import type { ItemRenderer } from "../registry.js";
import type { SkillBrowserItem, SkillCategoryItem, SkillSkillItem } from "../adapters/skillsAdapter.js";
import {
  SelectableRow,
  ListCategoryRow,
  ScopeSquares,
  ScopeDetail,
  ActionHints,
  MetaText,
  KeyValueLine,
  DetailSection,
} from "../components/primitives/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatStars(stars?: number): string {
  if (!stars) return "";
  if (stars >= 1000000) return `★ ${(stars / 1000000).toFixed(1)}M`;
  if (stars >= 10000) return `★ ${Math.round(stars / 1000)}K`;
  if (stars >= 1000) return `★ ${(stars / 1000).toFixed(1)}K`;
  return `★ ${stars}`;
}

// ─── Category renderer ────────────────────────────────────────────────────────

const categoryRenderer: ItemRenderer<SkillCategoryItem> = {
  renderRow: ({ item, isSelected }) => {
    const label = `${item.star ?? ""}${item.title}`;
    return (
      <ListCategoryRow
        selected={isSelected}
        title={label}
        count={item.count}
        badge={item.badge}
        tone={item.tone}
      />
    );
  },

  renderDetail: ({ item }) => {
    const isRec = item.categoryKey === "recommended";
    return (
      <box flexDirection="column">
        <text fg={isRec ? "green" : "cyan"}>
          <strong>
            {item.star ?? ""}
            {item.title}
          </strong>
        </text>
        <box marginTop={1}>
          <text fg="gray">
            {isRec
              ? "Curated skills recommended for most projects"
              : "Popular skills sorted by stars"}
          </text>
        </box>
      </box>
    );
  },
};

// ─── Skill renderer ───────────────────────────────────────────────────────────

const MAX_SKILL_NAME_LEN = 35;

function truncateName(name: string): string {
  return name.length > MAX_SKILL_NAME_LEN
    ? name.slice(0, MAX_SKILL_NAME_LEN - 1) + "\u2026"
    : name;
}

const skillRenderer: ItemRenderer<SkillSkillItem> = {
  renderRow: ({ item, isSelected }) => {
    const { skill } = item;
    const hasUser = skill.installedScope === "user";
    const hasProject = skill.installedScope === "project";
    const starsStr = formatStars(skill.stars);
    const displayName = truncateName(skill.name);

    return (
      <SelectableRow selected={isSelected} indent={1}>
        <ScopeSquares user={hasUser} project={hasProject} selected={isSelected} />
        <span> </span>
        <span fg={isSelected ? "white" : skill.installed ? "white" : "gray"}>
          {displayName}
        </span>
        {skill.hasUpdate ? <MetaText text=" ⬆" tone="warning" /> : null}
        {starsStr ? <MetaText text={`  ${starsStr}`} tone="warning" /> : null}
      </SelectableRow>
    );
  },

  renderDetail: ({ item }) => {
    const { skill } = item;
    const fm = skill.frontmatter;
    const description = fm?.description || skill.description || "Loading...";
    const starsStr = formatStars(skill.stars);

    return (
      <box flexDirection="column">
        <text fg="cyan">
          <strong>{skill.name}</strong>
          {starsStr ? <span fg="yellow">  {starsStr}</span> : null}
        </text>

        <box marginTop={1}>
          <text fg="white">{description}</text>
        </box>

        {fm?.category ? (
          <KeyValueLine
            label="Category"
            value={<span fg="cyan">{fm.category}</span>}
          />
        ) : null}
        {fm?.author ? (
          <KeyValueLine label="Author" value={<span>{fm.author}</span>} />
        ) : null}
        {fm?.version ? (
          <KeyValueLine label="Version" value={<span>{fm.version}</span>} />
        ) : null}
        {fm?.tags && fm.tags.length > 0 ? (
          <KeyValueLine
            label="Tags"
            value={<span>{(fm.tags as string[]).join(", ")}</span>}
          />
        ) : null}

        <DetailSection>
          <text>
            <span fg="gray">Source    </span>
            <span fg="#5c9aff">{skill.source.repo}</span>
          </text>
          <text>
            <span fg="gray">{"          "}</span>
            <span fg="gray">{skill.repoPath}</span>
          </text>
        </DetailSection>

        {skill.installed && skill.installedScope && (
          <DetailSection>
            <text>{"─".repeat(24)}</text>
            <ScopeDetail
              scopes={{
                user: skill.installedScope === "user",
                project: skill.installedScope === "project",
              }}
              paths={{
                user: "~/.claude/skills/",
                project: ".claude/skills/",
              }}
            />
          </DetailSection>
        )}

        {skill.hasUpdate && (
          <box marginTop={1}>
            <text bg="yellow" fg="black">
              {" "}
              UPDATE AVAILABLE{" "}
            </text>
          </box>
        )}

        <ActionHints
          hints={
            skill.installed
              ? [
                  { key: "d", label: "Uninstall", tone: "danger" },
                  { key: "u/p", label: "Reinstall in user/project scope" },
                  { key: "o", label: "Open in browser" },
                ]
              : [
                  { key: "u", label: "Install in user scope", tone: "primary" },
                  { key: "p", label: "Install in project scope", tone: "primary" },
                  { key: "o", label: "Open in browser" },
                ]
          }
        />
      </box>
    );
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const skillRenderers: {
  category: ItemRenderer<SkillCategoryItem>;
  skill: ItemRenderer<SkillSkillItem>;
} = {
  category: categoryRenderer,
  skill: skillRenderer,
};

/**
 * Dispatch rendering by item kind.
 */
export function renderSkillRow(
  item: SkillBrowserItem,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  if (item.kind === "category") {
    return skillRenderers.category.renderRow({ item, isSelected });
  }
  return skillRenderers.skill.renderRow({ item, isSelected });
}

export function renderSkillDetail(
  item: SkillBrowserItem | undefined,
): React.ReactNode {
  if (!item) return <text fg="gray">Select a skill to see details</text>;
  if (item.kind === "category") {
    return skillRenderers.category.renderDetail({ item });
  }
  return skillRenderers.skill.renderDetail({ item });
}
