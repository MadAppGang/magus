import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { STAR_RELIABILITY_INFO } from "../../data/skill-repos.js";
import { SelectableRow, ListCategoryRow, ScopeSquares, MetaText, KeyValueLine, DetailSection, } from "../components/primitives/index.js";
// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatStarsNum(stars) {
    if (!stars)
        return "";
    if (stars >= 1000000)
        return `${(stars / 1000000).toFixed(1)}M`;
    if (stars >= 10000)
        return `${Math.round(stars / 1000)}K`;
    if (stars >= 1000)
        return `${(stars / 1000).toFixed(1)}K`;
    return `${stars}`;
}
/** Star icon and color based on reliability classification */
function starIcon(reliability) {
    if (reliability === "mega-repo")
        return "☆";
    if (reliability === "skill-dump")
        return "☆";
    return "★";
}
function starColor(reliability) {
    if (reliability === "mega-repo")
        return "gray";
    if (reliability === "skill-dump")
        return "#888800";
    return "yellow";
}
function formatStars(stars, reliability) {
    if (!stars)
        return "";
    return `${starIcon(reliability)} ${formatStarsNum(stars)}`;
}
// ─── Category renderer ────────────────────────────────────────────────────────
const categoryRenderer = {
    renderRow: ({ item, isSelected }) => {
        const label = `${item.star ?? ""}${item.title}`;
        return (_jsx(ListCategoryRow, { selected: isSelected, title: label, count: item.count, badge: item.badge, tone: item.tone }));
    },
    renderDetail: ({ item }) => {
        const isRec = item.categoryKey === "recommended";
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: isRec ? "green" : "cyan", children: _jsxs("strong", { children: [item.star ?? "", item.title] }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "gray", children: isRec
                            ? "Curated skills recommended for most projects"
                            : "Popular skills sorted by stars" }) })] }));
    },
};
// ─── Skill renderer ───────────────────────────────────────────────────────────
const MAX_SKILL_NAME_LEN = 35;
function truncateName(name) {
    return name.length > MAX_SKILL_NAME_LEN
        ? name.slice(0, MAX_SKILL_NAME_LEN - 1) + "\u2026"
        : name;
}
const skillRenderer = {
    renderRow: ({ item, isSelected }) => {
        const { skill } = item;
        const hasUser = skill.installedScope === "user";
        const hasProject = skill.installedScope === "project";
        const reliability = skill.starReliability;
        const starsStr = formatStars(skill.stars, reliability);
        const sColor = starColor(reliability);
        const displayName = truncateName(skill.name);
        const indentLevel = item.indent ?? 1;
        return (_jsxs(SelectableRow, { selected: isSelected, indent: indentLevel, children: [_jsx(ScopeSquares, { user: hasUser, project: hasProject, selected: isSelected }), _jsx("span", { children: " " }), _jsx("span", { fg: isSelected ? "white" : skill.installed ? "white" : "gray", children: displayName }), skill.hasUpdate ? _jsx(MetaText, { text: " \u2B06", tone: "warning" }) : null, starsStr ? _jsx("span", { fg: sColor, children: `  ${starsStr}` }) : null] }));
    },
    renderDetail: ({ item }) => {
        const { skill } = item;
        const fm = skill.frontmatter;
        const description = fm?.description || skill.description || "Loading...";
        const reliability = skill.starReliability;
        const starsStr = formatStars(skill.stars, reliability);
        const sColor = starColor(reliability);
        const reliabilityInfo = reliability ? STAR_RELIABILITY_INFO[reliability] : null;
        return (_jsxs("box", { flexDirection: "column", children: [_jsxs("text", { fg: "cyan", children: [_jsx("strong", { children: skill.name }), starsStr ? _jsxs("span", { fg: sColor, children: ["  ", starsStr] }) : null] }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "white", children: description }) }), fm?.category ? (_jsx(KeyValueLine, { label: "Category", value: _jsx("span", { fg: "cyan", children: fm.category }) })) : null, fm?.author ? (_jsx(KeyValueLine, { label: "Author", value: _jsx("span", { children: fm.author }) })) : null, fm?.version ? (_jsx(KeyValueLine, { label: "Version", value: _jsx("span", { children: fm.version }) })) : null, fm?.tags && fm.tags.length > 0 ? (_jsx(KeyValueLine, { label: "Tags", value: _jsx("span", { children: fm.tags.join(", ") }) })) : null, _jsxs(DetailSection, { children: [_jsxs("text", { children: [_jsx("span", { fg: "gray", children: "Source    " }), _jsx("span", { fg: "#5c9aff", children: skill.source.repo })] }), _jsxs("text", { children: [_jsx("span", { fg: "gray", children: "          " }), _jsx("span", { fg: "gray", children: skill.repoPath })] })] }), reliabilityInfo && reliability !== "dedicated" && (_jsx("box", { marginTop: 1, children: _jsxs("text", { children: [_jsxs("span", { fg: sColor, children: [starIcon(reliability), " "] }), _jsx("span", { fg: sColor, children: _jsx("strong", { children: reliabilityInfo.label }) }), _jsxs("span", { fg: "gray", children: [" \u2014 ", reliabilityInfo.description] })] }) })), _jsxs(DetailSection, { children: [_jsx("text", { children: "─".repeat(24) }), _jsx("text", { children: _jsx("strong", { children: "Scopes:" }) }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("text", { children: [_jsx("span", { bg: "cyan", fg: "black", children: " u " }), _jsx("span", { fg: skill.installedScope === "user" ? "cyan" : "gray", children: skill.installedScope === "user" ? " ● " : " ○ " }), _jsx("span", { fg: "cyan", children: "User" }), _jsx("span", { fg: "gray", children: " ~/.claude/skills/" })] }), _jsxs("text", { children: [_jsx("span", { bg: "green", fg: "black", children: " p " }), _jsx("span", { fg: skill.installedScope === "project" ? "green" : "gray", children: skill.installedScope === "project" ? " ● " : " ○ " }), _jsx("span", { fg: "green", children: "Project" }), _jsx("span", { fg: "gray", children: " .claude/skills/" })] })] })] }), skill.hasUpdate && (_jsx("box", { marginTop: 1, children: _jsx("text", { bg: "yellow", fg: "black", children: " UPDATE AVAILABLE " }) })), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "gray", children: skill.installed
                            ? "Press u/p to toggle scope"
                            : "Press u/p to install" }) }), _jsx("box", { children: _jsxs("text", { children: [_jsx("span", { bg: "#555555", fg: "white", children: " o " }), _jsx("span", { fg: "gray", children: " Open in browser" })] }) })] }));
    },
};
// ─── Skill Set renderer ──────────────────────────────────────────────────────
const MAX_SET_NAME_LEN = 28;
const skillSetRenderer = {
    renderRow: ({ item, isSelected }) => {
        const { skillSet, expanded } = item;
        const arrow = expanded ? "\u25BC" : "\u25B6";
        const displayName = skillSet.name.length > MAX_SET_NAME_LEN
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
        return (_jsxs(SelectableRow, { selected: isSelected, indent: 1, children: [_jsxs("span", { fg: isSelected ? "white" : "gray", children: [arrow, " "] }), _jsxs("span", { fg: isSelected ? "white" : "yellow", children: [skillSet.icon, " "] }), _jsx("span", { fg: isSelected ? "white" : "cyan", children: _jsx("strong", { children: displayName }) }), _jsxs("span", { fg: "gray", children: ["  ", countStr] }), starsStr ? _jsx(MetaText, { text: `  ${starsStr}`, tone: "warning" }) : null, _jsx("span", { children: "  " }), _jsx(ScopeSquares, { user: hasUser, project: hasProject, selected: isSelected })] }));
    },
    renderDetail: ({ item }) => {
        const { skillSet, expanded } = item;
        const starsStr = formatStars(skillSet.stars);
        return (_jsxs("box", { flexDirection: "column", children: [_jsxs("text", { fg: "cyan", children: [_jsxs("strong", { children: [skillSet.icon, " ", skillSet.name] }), starsStr ? _jsxs("span", { fg: "yellow", children: ["  ", starsStr] }) : null] }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "white", children: skillSet.description }) }), _jsx(DetailSection, { children: _jsxs("text", { children: [_jsx("span", { fg: "gray", children: "Source    " }), _jsx("span", { fg: "#5c9aff", children: skillSet.repo })] }) }), skillSet.loading && (_jsx("box", { marginTop: 1, children: _jsx("text", { fg: "yellow", children: "Loading skills..." }) })), skillSet.error && (_jsx("box", { marginTop: 1, children: _jsxs("text", { fg: "red", children: ["Error: ", skillSet.error] }) })), skillSet.loaded && skillSet.skills.length > 0 && (_jsxs(DetailSection, { children: [_jsxs("text", { children: [_jsx("strong", { children: "Skills in this set:" }), _jsxs("span", { fg: "gray", children: [" ", "(", skillSet.skills.filter((s) => s.installed).length, "/", skillSet.skills.length, " installed)"] })] }), _jsx("box", { marginTop: 1, flexDirection: "column", children: skillSet.skills.map((s) => (_jsxs("text", { children: [_jsx("span", { fg: s.installedScope === "user" ? "cyan" : "gray", children: s.installedScope === "user" ? "\u25A0" : "\u25A1" }), _jsx("span", { fg: s.installedScope === "project" ? "green" : "gray", children: s.installedScope === "project" ? "\u25A0" : "\u25A1" }), _jsxs("span", { fg: s.installed ? "white" : "gray", children: [" ", s.name] })] }, s.id))) })] })), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "gray", children: expanded
                            ? "Press Enter to collapse \u2022 u/p to install all"
                            : "Press Enter to expand \u2022 u/p to install all" }) }), _jsx("box", { children: _jsxs("text", { children: [_jsx("span", { bg: "#555555", fg: "white", children: " o " }), _jsx("span", { fg: "gray", children: " Open in browser" })] }) })] }));
    },
};
// ─── Registry ─────────────────────────────────────────────────────────────────
export const skillRenderers = {
    category: categoryRenderer,
    skill: skillRenderer,
    skillset: skillSetRenderer,
};
/**
 * Dispatch rendering by item kind.
 */
export function renderSkillRow(item, _index, isSelected) {
    if (item.kind === "category") {
        return skillRenderers.category.renderRow({ item, isSelected });
    }
    if (item.kind === "skillset") {
        return skillRenderers.skillset.renderRow({ item, isSelected });
    }
    return skillRenderers.skill.renderRow({ item, isSelected });
}
export function renderSkillDetail(item) {
    if (!item)
        return _jsx("text", { fg: "gray", children: "Select a skill to see details" });
    if (item.kind === "category") {
        return skillRenderers.category.renderDetail({ item });
    }
    if (item.kind === "skillset") {
        return skillRenderers.skillset.renderDetail({ item });
    }
    return skillRenderers.skill.renderDetail({ item });
}
