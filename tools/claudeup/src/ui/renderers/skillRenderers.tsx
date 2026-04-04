import React from "react";
import type { ItemRenderer } from "../registry.js";
import type { SkillBrowserItem, SkillCategoryItem, SkillSkillItem, SkillSetItem } from "../adapters/skillsAdapter.js";
import type { StarReliability } from "../../types/index.js";
import { STAR_RELIABILITY_INFO } from "../../data/skill-repos.js";
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

function formatStarsNum(stars?: number): string {
  if (!stars) return "";
  if (stars >= 1000000) return `${(stars / 1000000).toFixed(1)}M`;
  if (stars >= 10000) return `${Math.round(stars / 1000)}K`;
  if (stars >= 1000) return `${(stars / 1000).toFixed(1)}K`;
  return `${stars}`;
}

/** Star icon and color based on reliability classification */
function starIcon(reliability?: StarReliability): string {
  if (reliability === "mega-repo") return "☆";
  if (reliability === "skill-dump") return "☆";
  return "★";
}

function starColor(reliability?: StarReliability): string {
  if (reliability === "mega-repo") return "gray";
  if (reliability === "skill-dump") return "#888800";
  return "yellow";
}

function formatStars(stars?: number, reliability?: StarReliability): string {
  if (!stars) return "";
  return `${starIcon(reliability)} ${formatStarsNum(stars)}`;
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
    const reliability = skill.starReliability;
    const starsStr = formatStars(skill.stars, reliability);
    const sColor = starColor(reliability);
    const displayName = truncateName(skill.name);
    const indentLevel = item.indent ?? 1;

    return (
      <SelectableRow selected={isSelected} indent={indentLevel}>
        <ScopeSquares user={hasUser} project={hasProject} selected={isSelected} />
        <span> </span>
        <span fg={isSelected ? "white" : skill.installed ? "white" : "gray"}>
          {displayName}
        </span>
        {skill.hasUpdate ? <MetaText text=" ⬆" tone="warning" /> : null}
        {starsStr ? <span fg={sColor}>{`  ${starsStr}`}</span> : null}
      </SelectableRow>
    );
  },

  renderDetail: ({ item }) => {
    const { skill } = item;
    const fm = skill.frontmatter;
    const description = fm?.description || skill.description || "Loading...";
    const reliability = skill.starReliability;
    const starsStr = formatStars(skill.stars, reliability);
    const sColor = starColor(reliability);
    const reliabilityInfo = reliability ? STAR_RELIABILITY_INFO[reliability] : null;

    return (
      <box flexDirection="column">
        <text fg="cyan">
          <strong>{skill.name}</strong>
          {starsStr ? <span fg={sColor}>  {starsStr}</span> : null}
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

        {reliabilityInfo && reliability !== "dedicated" && (
          <box marginTop={1}>
            <text>
              <span fg={sColor}>{starIcon(reliability)} </span>
              <span fg={sColor}><strong>{reliabilityInfo.label}</strong></span>
              <span fg="gray"> — {reliabilityInfo.description}</span>
            </text>
          </box>
        )}

        <DetailSection>
          <text>{"─".repeat(24)}</text>
          <text><strong>Scopes:</strong></text>
          <box marginTop={1} flexDirection="column">
            <text>
              <span bg="cyan" fg="black"> u </span>
              <span fg={skill.installedScope === "user" ? "cyan" : "gray"}>
                {skill.installedScope === "user" ? " ● " : " ○ "}
              </span>
              <span fg="cyan">User</span>
              <span fg="gray"> ~/.claude/skills/</span>
            </text>
            <text>
              <span bg="green" fg="black"> p </span>
              <span fg={skill.installedScope === "project" ? "green" : "gray"}>
                {skill.installedScope === "project" ? " ● " : " ○ "}
              </span>
              <span fg="green">Project</span>
              <span fg="gray"> .claude/skills/</span>
            </text>
          </box>
        </DetailSection>

        {skill.hasUpdate && (
          <box marginTop={1}>
            <text bg="yellow" fg="black"> UPDATE AVAILABLE </text>
          </box>
        )}

        <box marginTop={1}>
          <text fg="gray">
            {skill.installed
              ? "Press u/p to toggle scope"
              : "Press u/p to install"}
          </text>
        </box>
        <box>
          <text>
            <span bg="#555555" fg="white"> o </span>
            <span fg="gray"> Open in browser</span>
          </text>
        </box>
      </box>
    );
  },
};

// ─── Skill Set renderer ──────────────────────────────────────────────────────

const MAX_SET_NAME_LEN = 28;

const skillSetRenderer: ItemRenderer<SkillSetItem> = {
  renderRow: ({ item, isSelected }) => {
    const { skillSet, expanded } = item;
    const arrow = expanded ? "\u25BC" : "\u25B6";
    const displayName =
      skillSet.name.length > MAX_SET_NAME_LEN
        ? skillSet.name.slice(0, MAX_SET_NAME_LEN - 1) + "\u2026"
        : skillSet.name;

    // Count installed child skills
    const installedCount = skillSet.loaded
      ? skillSet.skills.filter((s) => s.installed).length
      : 0;
    const totalCount = skillSet.loaded ? skillSet.skills.length : "...";
    const countStr = `(${installedCount}/${totalCount})`;

    // Any child installed at user or project scope?
    const hasUser = skillSet.loaded && skillSet.skills.some((s) => s.installedScope === "user");
    const hasProject = skillSet.loaded && skillSet.skills.some((s) => s.installedScope === "project");

    const starsStr = formatStars(skillSet.stars);

    return (
      <SelectableRow selected={isSelected} indent={1}>
        <span fg={isSelected ? "white" : "gray"}>{arrow} </span>
        <span fg={isSelected ? "white" : "yellow"}>{skillSet.icon} </span>
        <span fg={isSelected ? "white" : "cyan"}>
          <strong>{displayName}</strong>
        </span>
        <span fg="gray">  {countStr}</span>
        {starsStr ? <MetaText text={`  ${starsStr}`} tone="warning" /> : null}
        <span>  </span>
        <ScopeSquares user={hasUser} project={hasProject} selected={isSelected} />
      </SelectableRow>
    );
  },

  renderDetail: ({ item }) => {
    const { skillSet, expanded } = item;
    const starsStr = formatStars(skillSet.stars);

    return (
      <box flexDirection="column">
        <text fg="cyan">
          <strong>
            {skillSet.icon} {skillSet.name}
          </strong>
          {starsStr ? <span fg="yellow">  {starsStr}</span> : null}
        </text>

        <box marginTop={1}>
          <text fg="white">{skillSet.description}</text>
        </box>

        <DetailSection>
          <text>
            <span fg="gray">Source    </span>
            <span fg="#5c9aff">{skillSet.repo}</span>
          </text>
        </DetailSection>

        {skillSet.loading && (
          <box marginTop={1}>
            <text fg="yellow">Loading skills...</text>
          </box>
        )}

        {skillSet.error && (
          <box marginTop={1}>
            <text fg="red">Error: {skillSet.error}</text>
          </box>
        )}

        {skillSet.loaded && skillSet.skills.length > 0 && (
          <DetailSection>
            <text>
              <strong>Skills in this set:</strong>
              <span fg="gray">
                {" "}
                ({skillSet.skills.filter((s) => s.installed).length}/
                {skillSet.skills.length} installed)
              </span>
            </text>
            <box marginTop={1} flexDirection="column">
              {skillSet.skills.map((s) => (
                <text key={s.id}>
                  <span fg={s.installedScope === "user" ? "cyan" : "gray"}>
                    {s.installedScope === "user" ? "\u25A0" : "\u25A1"}
                  </span>
                  <span fg={s.installedScope === "project" ? "green" : "gray"}>
                    {s.installedScope === "project" ? "\u25A0" : "\u25A1"}
                  </span>
                  <span fg={s.installed ? "white" : "gray"}> {s.name}</span>
                </text>
              ))}
            </box>
          </DetailSection>
        )}

        <box marginTop={1}>
          <text fg="gray">
            {expanded
              ? "Press Enter to collapse \u2022 u/p to install all"
              : "Press Enter to expand \u2022 u/p to install all"}
          </text>
        </box>
        <box>
          <text>
            <span bg="#555555" fg="white"> o </span>
            <span fg="gray"> Open in browser</span>
          </text>
        </box>
      </box>
    );
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const skillRenderers: {
  category: ItemRenderer<SkillCategoryItem>;
  skill: ItemRenderer<SkillSkillItem>;
  skillset: ItemRenderer<SkillSetItem>;
} = {
  category: categoryRenderer,
  skill: skillRenderer,
  skillset: skillSetRenderer,
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
  if (item.kind === "skillset") {
    return skillRenderers.skillset.renderRow({ item, isSelected });
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
  if (item.kind === "skillset") {
    return skillRenderers.skillset.renderDetail({ item });
  }
  return skillRenderers.skill.renderDetail({ item });
}
