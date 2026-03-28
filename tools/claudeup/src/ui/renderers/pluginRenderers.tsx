import React from "react";
import type {
  PluginBrowserItem,
  PluginCategoryItem,
  PluginPluginItem,
} from "../adapters/pluginsAdapter.js";
import { CategoryHeader } from "../components/CategoryHeader.js";
import {
  SelectableRow,
  ScopeSquares,
  ActionHints,
  MetaText,
  KeyValueLine,
  DetailSection,
} from "../components/primitives/index.js";
import { theme } from "../theme.js";
import { highlightMatches } from "../../utils/fuzzy-search.js";

// ─── Category renderers ───────────────────────────────────────────────────────

function categoryRow(item: PluginCategoryItem, isSelected: boolean): React.ReactNode {
  const mp = item.marketplace;

  if (isSelected) {
    const arrow = item.isExpanded ? "▼" : "▶";
    const count = item.pluginCount > 0 ? ` (${item.pluginCount})` : "";
    return (
      <SelectableRow selected={true}>
        <strong>
          {" "}
          {arrow} {mp.displayName}
          {count}{" "}
        </strong>
      </SelectableRow>
    );
  }

  // Map tone to a statusColor for CategoryHeader (legacy component)
  const statusColorMap: Record<PluginCategoryItem["tone"], string> = {
    yellow: "yellow",
    gray: "gray",
    green: "green",
    red: "red",
    purple: theme.colors.accent,
    teal: "cyan",
  };

  return (
    <CategoryHeader
      title={mp.displayName}
      expanded={item.isExpanded}
      count={item.pluginCount}
      status={item.badge}
      statusColor={statusColorMap[item.tone]}
    />
  );
}

function categoryDetail(
  item: PluginCategoryItem,
  collapsedMarketplaces: Set<string>,
): React.ReactNode {
  const mp = item.marketplace;
  const isEnabled = item.marketplaceEnabled;
  const isCollapsed = collapsedMarketplaces.has(mp.name);
  const hasPlugins = item.pluginCount > 0;

  let actionHint = "Add";
  if (isEnabled) {
    if (isCollapsed) {
      actionHint = "Expand";
    } else if (hasPlugins) {
      actionHint = "Collapse";
    } else {
      actionHint = "Remove";
    }
  }

  return (
    <box flexDirection="column">
      <text fg={theme.colors.info}>
        <strong>
          {mp.displayName}
          {item.badge ? ` ${item.badge}` : ""}
        </strong>
      </text>
      <text fg={theme.colors.muted}>{mp.description || "No description"}</text>
      <text fg={isEnabled ? theme.colors.success : theme.colors.muted}>
        {isEnabled ? "● Added" : "○ Not added"}
      </text>
      <text fg={theme.colors.link}>github.com/{mp.source.repo}</text>
      <text>Plugins: {item.pluginCount}</text>
      <ActionHints
        hints={[
          { key: "Enter", label: actionHint, tone: isEnabled ? "primary" : "default" },
        ]}
      />
      {isEnabled ? (
        <box>
          <text fg={theme.colors.muted}>← → to expand/collapse</text>
        </box>
      ) : null}
    </box>
  );
}

// ─── Plugin renderers ─────────────────────────────────────────────────────────

function pluginRow(item: PluginPluginItem, isSelected: boolean): React.ReactNode {
  const { plugin } = item;
  const hasUser = !!plugin.userScope?.enabled;
  const hasProject = !!plugin.projectScope?.enabled;
  const hasLocal = !!plugin.localScope?.enabled;
  const hasAnyScope = hasUser || hasProject || hasLocal;

  // Build version string
  let versionStr = "";
  if (plugin.isOrphaned) {
    versionStr = " deprecated";
  } else if (plugin.installedVersion && plugin.installedVersion !== "0.0.0") {
    versionStr = ` v${plugin.installedVersion}`;
    if (plugin.hasUpdate && plugin.version) {
      versionStr += ` → v${plugin.version}`;
    }
  }

  if (isSelected) {
    return (
      <text bg={theme.selection.bg} fg={theme.selection.fg}>
        {" "}
        <ScopeSquares user={hasUser} project={hasProject} local={hasLocal} selected={true} />
        {" "}{plugin.name}{versionStr}{" "}
      </text>
    );
  }

  // Fuzzy highlight
  const segments = item.matches ? highlightMatches(plugin.name, item.matches) : null;
  const displayName = segments ? segments.map((seg) => seg.text).join("") : plugin.name;

  if (plugin.isOrphaned) {
    const ver =
      plugin.installedVersion && plugin.installedVersion !== "0.0.0"
        ? ` v${plugin.installedVersion}`
        : "";
    return (
      <text>
        <span fg={theme.colors.danger}> ■■■ </span>
        <span fg={theme.colors.muted}>{displayName}</span>
        {ver ? <span fg={theme.colors.warning}>{ver}</span> : null}
        <span fg={theme.colors.danger}> deprecated</span>
      </text>
    );
  }

  return (
    <text>
      <span> </span>
      <ScopeSquares user={hasUser} project={hasProject} local={hasLocal} />
      <span> </span>
      <span fg={hasAnyScope ? theme.colors.text : theme.colors.muted}>{displayName}</span>
      <MetaText text={versionStr} tone={plugin.hasUpdate ? "warning" : "muted"} />
    </text>
  );
}

function pluginDetail(item: PluginPluginItem): React.ReactNode {
  const { plugin } = item;
  const isInstalled =
    plugin.userScope?.enabled ||
    plugin.projectScope?.enabled ||
    plugin.localScope?.enabled;

  // Orphaned/deprecated plugin
  if (plugin.isOrphaned) {
    return (
      <box flexDirection="column">
        <box justifyContent="center">
          <text bg={theme.colors.warning} fg="black">
            <strong> {plugin.name} — DEPRECATED </strong>
          </text>
        </box>
        <box marginTop={1}>
          <text fg={theme.colors.warning}>
            This plugin is no longer in the marketplace.
          </text>
        </box>
        <box marginTop={1}>
          <text fg={theme.colors.muted}>
            It was removed from the marketplace but still referenced in your settings. Press d to
            uninstall and clean up.
          </text>
        </box>
        <ActionHints
          hints={[{ key: "d", label: isInstalled ? "Remove from all scopes" : "Clean up stale reference", tone: "danger" }]}
        />
      </box>
    );
  }

  // Build component counts
  const components: string[] = [];
  if (plugin.agents?.length) components.push(`${plugin.agents.length} agents`);
  if (plugin.commands?.length) components.push(`${plugin.commands.length} commands`);
  if (plugin.skills?.length) components.push(`${plugin.skills.length} skills`);
  if (plugin.mcpServers?.length) components.push(`${plugin.mcpServers.length} MCP`);
  if (plugin.lspServers && Object.keys(plugin.lspServers).length) {
    components.push(`${Object.keys(plugin.lspServers).length} LSP`);
  }

  const showVersion = plugin.version && plugin.version !== "0.0.0";
  const showInstalledVersion =
    plugin.installedVersion && plugin.installedVersion !== "0.0.0";

  return (
    <box flexDirection="column">
      {/* Plugin name header */}
      <box justifyContent="center">
        <text bg={theme.selection.bg} fg={theme.selection.fg}>
          <strong>
            {" "}
            {plugin.name}
            {plugin.hasUpdate ? " ⬆" : ""}{" "}
          </strong>
        </text>
      </box>

      {/* Status line */}
      <box marginTop={1}>
        <text fg={isInstalled ? theme.colors.success : theme.colors.muted}>
          {isInstalled ? "● Installed" : "○ Not installed"}
        </text>
      </box>

      {/* Description */}
      <box marginTop={1} marginBottom={1}>
        <text fg={theme.colors.text}>{plugin.description}</text>
      </box>

      {/* Metadata */}
      {showVersion ? (
        <KeyValueLine
          label="Version"
          value={
            <span>
              <span fg={theme.colors.link}>v{plugin.version}</span>
              {showInstalledVersion && plugin.installedVersion !== plugin.version ? (
                <span> (v{plugin.installedVersion} installed)</span>
              ) : null}
            </span>
          }
        />
      ) : null}
      {plugin.category ? (
        <KeyValueLine
          label="Category"
          value={<span fg={theme.colors.accent}>{plugin.category}</span>}
        />
      ) : null}
      {plugin.author ? (
        <KeyValueLine label="Author" value={<span>{plugin.author.name}</span>} />
      ) : null}
      {components.length > 0 ? (
        <KeyValueLine
          label="Contains"
          value={<span fg={theme.colors.warning}>{components.join(" · ")}</span>}
        />
      ) : null}

      {/* Scope Status */}
      <DetailSection>
        <text>{"─".repeat(24)}</text>
        <text>
          <strong>Scopes:</strong>
        </text>
        <box marginTop={1} flexDirection="column">
          <text>
            <span bg={theme.scopes.user} fg="black">
              {" "}
              u{" "}
            </span>
            <span fg={plugin.userScope?.enabled ? theme.scopes.user : theme.colors.muted}>
              {plugin.userScope?.enabled ? " ● " : " ○ "}
            </span>
            <span fg={theme.scopes.user}>User</span>
            <span> global</span>
            {plugin.userScope?.version ? (
              <span fg={theme.scopes.user}> v{plugin.userScope.version}</span>
            ) : null}
          </text>
          <text>
            <span bg={theme.scopes.project} fg="black">
              {" "}
              p{" "}
            </span>
            <span fg={plugin.projectScope?.enabled ? theme.scopes.project : theme.colors.muted}>
              {plugin.projectScope?.enabled ? " ● " : " ○ "}
            </span>
            <span fg={theme.scopes.project}>Project</span>
            <span> team</span>
            {plugin.projectScope?.version ? (
              <span fg={theme.scopes.project}> v{plugin.projectScope.version}</span>
            ) : null}
          </text>
          <text>
            <span bg={theme.scopes.local} fg="black">
              {" "}
              l{" "}
            </span>
            <span fg={plugin.localScope?.enabled ? theme.scopes.local : theme.colors.muted}>
              {plugin.localScope?.enabled ? " ● " : " ○ "}
            </span>
            <span fg={theme.scopes.local}>Local</span>
            <span> private</span>
            {plugin.localScope?.version ? (
              <span fg={theme.scopes.local}> v{plugin.localScope.version}</span>
            ) : null}
          </text>
        </box>
      </DetailSection>

      {/* Update action */}
      {isInstalled && plugin.hasUpdate ? (
        <ActionHints
          hints={[{ key: "U", label: `Update to v${plugin.version}`, tone: "primary" }]}
        />
      ) : null}
    </box>
  );
}

// ─── Public dispatch functions ────────────────────────────────────────────────

/**
 * Render a plugin browser list row by item kind.
 */
export function renderPluginRow(
  item: PluginBrowserItem,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  if (item.kind === "category") {
    return categoryRow(item, isSelected);
  }
  return pluginRow(item, isSelected);
}

/**
 * Render the detail panel for a plugin browser item.
 */
export function renderPluginDetail(
  item: PluginBrowserItem | undefined,
  collapsedMarketplaces: Set<string>,
): React.ReactNode {
  if (!item) return <text fg={theme.colors.muted}>Select an item</text>;
  if (item.kind === "category") {
    return categoryDetail(item, collapsedMarketplaces);
  }
  return pluginDetail(item);
}
