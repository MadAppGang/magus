import React from "react";
import type { ItemRenderer } from "../registry.js";
import type { ProfileEntry } from "../../types/index.js";
import type { PredefinedProfile } from "../../data/predefined-profiles.js";
import { theme } from "../theme.js";

// ─── List item types ───────────────────────────────────────────────────────────

export type ProfileListItem =
  | { kind: "header"; label: string; color: string; count: number }
  | { kind: "predefined"; profile: PredefinedProfile }
  | { kind: "saved"; entry: ProfileEntry };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "\u2026";
}

export function humanizeValue(_key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value !== "string") return String(value);
  if (value === "claude-sonnet-4-6") return "Sonnet";
  if (value === "claude-opus-4-6") return "Opus";
  if (value === "claude-haiku-4-6") return "Haiku";
  if (value.startsWith("claude-sonnet")) return "Sonnet";
  if (value.startsWith("claude-opus")) return "Opus";
  if (value.startsWith("claude-haiku")) return "Haiku";
  return value;
}

export function humanizeKey(key: string): string {
  const labels: Record<string, string> = {
    effortLevel: "Effort",
    model: "Model",
    outputStyle: "Output",
    alwaysThinkingEnabled: "Thinking",
    includeGitInstructions: "Git Instructions",
    respectGitignore: "Gitignore",
    enableAllProjectMcpServers: "Auto MCP",
    autoUpdatesChannel: "Updates",
    language: "Language",
    cleanupPeriodDays: "Cleanup",
  };
  return labels[key] ?? key;
}

export function stripSuffix(pluginName: string): string {
  return pluginName
    .replace(/@magus$/, "")
    .replace(/@claude-plugins-official$/, "");
}

export function wrapNames(names: string[], lineMax = 40): string[] {
  const lines: string[] = [];
  let current = "";
  for (const name of names) {
    const add = current ? `, ${name}` : name;
    if (current && current.length + add.length > lineMax) {
      lines.push(current);
      current = name;
    } else {
      current += current ? `, ${name}` : name;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Header renderer ───────────────────────────────────────────────────────────

const headerRenderer: ItemRenderer<{
  kind: "header";
  label: string;
  color: string;
  count: number;
}> = {
  renderRow: ({ item }) => (
    <text bg={item.color} fg="white">
      <strong>
        {" "}
        {item.label} ({item.count}){" "}
      </strong>
    </text>
  ),
  renderDetail: () => (
    <text fg={theme.colors.muted}>Select a profile to see details</text>
  ),
};

// ─── Predefined renderer ───────────────────────────────────────────────────────

const DIVIDER = "────────────────────────";

const predefinedRenderer: ItemRenderer<{ kind: "predefined"; profile: PredefinedProfile }> = {
  renderRow: ({ item, isSelected }) => {
    const { profile } = item;
    const pluginCount =
      profile.magusPlugins.length + profile.anthropicPlugins.length;
    const skillCount = profile.skills.length;
    const label = truncate(
      `${profile.name} — ${pluginCount} plugins · ${skillCount} skill${skillCount !== 1 ? "s" : ""}`,
      45,
    );

    if (isSelected) {
      return (
        <text bg="blue" fg="white">
          {" "}
          {label}{" "}
        </text>
      );
    }

    return (
      <text>
        <span fg={theme.colors.muted}>{"- "}</span>
        <span fg={theme.colors.text}>{label}</span>
      </text>
    );
  },

  renderDetail: ({ item }) => {
    const { profile } = item;
    const settingEntries = Object.entries(profile.settings).filter(
      ([k]) => k !== "env",
    );
    const envMap =
      (profile.settings["env"] as Record<string, string> | undefined) ?? {};
    const tasksOn = envMap["CLAUDE_CODE_ENABLE_TASKS"] === "true";
    const teamsOn = envMap["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "true";

    return (
      <box flexDirection="column">
        <text fg={theme.colors.info}>
          <strong>{profile.name}</strong>
        </text>
        <box marginTop={1}>
          <text fg={theme.colors.muted}>{profile.description}</text>
        </box>

        {/* Magus plugins */}
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.muted}>Magus ({profile.magusPlugins.length})</text>
          {profile.magusPlugins.map((p) => (
            <text key={p}>
              <span fg="#00bfa5">  ■ </span>
              <span fg="white">{p}</span>
            </text>
          ))}
        </box>

        {/* Anthropic plugins */}
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.muted}>Anthropic ({profile.anthropicPlugins.length})</text>
          {profile.anthropicPlugins.map((p) => (
            <text key={p}>
              <span fg="#b39ddb">  ■ </span>
              <span fg="white">{p}</span>
            </text>
          ))}
        </box>

        {/* Skills */}
        {profile.skills.length > 0 && (
          <box marginTop={1} flexDirection="column">
            <text fg={theme.colors.muted}>Skills ({profile.skills.length})</text>
            {profile.skills.map((s) => (
              <text key={s}>
                <span fg="#ffd54f">  ■ </span>
                <span fg="white">{s}</span>
              </text>
            ))}
          </box>
        )}

        <text fg={theme.colors.dim}>{DIVIDER}</text>

        {/* Settings as clean key-value */}
        <box flexDirection="column">
          {settingEntries.map(([k, v]) => (
            <text key={k}>
              <span fg={theme.colors.muted}>  {humanizeKey(k).padEnd(16)}</span>
              <span fg={theme.colors.text}>{humanizeValue(k, v)}</span>
            </text>
          ))}
          {tasksOn && (
            <text>
              <span fg={theme.colors.muted}>  {"Tasks".padEnd(16)}</span>
              <span fg="green">on</span>
            </text>
          )}
          {teamsOn && (
            <text>
              <span fg={theme.colors.muted}>  {"Agent Teams".padEnd(16)}</span>
              <span fg="green">on</span>
            </text>
          )}
        </box>
        <box marginTop={1}>
          <text fg={theme.colors.dim}>{DIVIDER}</text>
        </box>
        <box marginTop={1}>
          <text bg="blue" fg="white">
            {" "}
            Enter/a{" "}
          </text>
          <text fg={theme.colors.muted}> Apply to project</text>
        </box>
      </box>
    );
  },
};

// ─── Saved renderer ────────────────────────────────────────────────────────────

const savedRenderer: ItemRenderer<{ kind: "saved"; entry: ProfileEntry }> = {
  renderRow: ({ item, isSelected }) => {
    const { entry } = item;
    const pluginCount = Object.keys(entry.plugins).length;
    const dateStr = formatDate(entry.updatedAt);
    const label = truncate(
      `${entry.name} — ${pluginCount} plugin${pluginCount !== 1 ? "s" : ""} · ${dateStr}`,
      45,
    );

    if (isSelected) {
      return (
        <text bg={theme.selection.bg} fg={theme.selection.fg}>
          {" "}
          {label}{" "}
        </text>
      );
    }

    const scopeColor =
      entry.scope === "user" ? theme.scopes.user : theme.scopes.project;
    const scopeLabel = entry.scope === "user" ? "[user]" : "[proj]";

    return (
      <text>
        <span fg={scopeColor}>{scopeLabel} </span>
        <span fg={theme.colors.text}>{label}</span>
      </text>
    );
  },

  renderDetail: ({ item }) => {
    const { entry: selectedProfile } = item;
    const plugins = Object.keys(selectedProfile.plugins);
    const cleanPlugins = plugins.map(stripSuffix);
    const scopeColor =
      selectedProfile.scope === "user" ? theme.scopes.user : theme.scopes.project;
    const scopeLabel =
      selectedProfile.scope === "user"
        ? "User (~/.claude/profiles.json)"
        : "Project (.claude/profiles.json — committed to git)";

    return (
      <box flexDirection="column">
        <text fg={theme.colors.info}>
          <strong>{selectedProfile.name}</strong>
        </text>
        <box marginTop={1}>
          <text fg={theme.colors.muted}>Scope: </text>
          <text fg={scopeColor}>{scopeLabel}</text>
        </box>
        <box marginTop={1}>
          <text fg={theme.colors.muted}>
            Created: {formatDate(selectedProfile.createdAt)} · Updated:{" "}
            {formatDate(selectedProfile.updatedAt)}
          </text>
        </box>
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.muted}>
            Plugins ({plugins.length}
            {plugins.length === 0 ? " — applying will disable all plugins" : ""}
            ):
          </text>
          {cleanPlugins.length === 0 ? (
            <text fg={theme.colors.warning}> (none)</text>
          ) : (
            wrapNames(cleanPlugins).map((line, i) => (
              <text key={i} fg={theme.colors.text}>
                {"  "}
                {line}
              </text>
            ))
          )}
        </box>
        <box marginTop={2} flexDirection="column">
          <box>
            <text bg={theme.selection.bg} fg={theme.selection.fg}>
              {" "}
              Enter/a{" "}
            </text>
            <text fg={theme.colors.muted}> Apply profile</text>
          </box>
          <box marginTop={1}>
            <text bg={theme.colors.dim} fg="white">
              {" "}
              r{" "}
            </text>
            <text fg={theme.colors.muted}> Rename</text>
          </box>
          <box marginTop={1}>
            <text bg={theme.colors.danger} fg="white">
              {" "}
              d{" "}
            </text>
            <text fg={theme.colors.muted}> Delete</text>
          </box>
          <box marginTop={1}>
            <text bg="blue" fg="white">
              {" "}
              c{" "}
            </text>
            <text fg={theme.colors.muted}> Copy JSON to clipboard</text>
          </box>
          <box marginTop={1}>
            <text bg={theme.colors.success} fg="white">
              {" "}
              i{" "}
            </text>
            <text fg={theme.colors.muted}> Import from clipboard</text>
          </box>
        </box>
      </box>
    );
  },
};

// ─── Dispatch helpers ──────────────────────────────────────────────────────────

export function renderProfileRow(
  item: ProfileListItem,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  if (item.kind === "header") {
    return headerRenderer.renderRow({ item, isSelected });
  }
  if (item.kind === "predefined") {
    return predefinedRenderer.renderRow({ item, isSelected });
  }
  return savedRenderer.renderRow({ item, isSelected });
}

export function renderProfileDetail(
  item: ProfileListItem | undefined,
  loading: boolean,
  error: string | undefined,
): React.ReactNode {
  if (loading) return <text fg={theme.colors.muted}>Loading profiles...</text>;
  if (error) return <text fg={theme.colors.danger}>Error: {error}</text>;
  if (!item || item.kind === "header")
    return <text fg={theme.colors.muted}>Select a profile to see details</text>;
  if (item.kind === "predefined") {
    return predefinedRenderer.renderDetail({ item });
  }
  return savedRenderer.renderDetail({ item });
}

export function buildProfileListItems(
  profileList: import("../../types/index.js").ProfileEntry[],
  PREDEFINED_PROFILES: PredefinedProfile[],
): ProfileListItem[] {
  const items: ProfileListItem[] = [];
  items.push({
    kind: "header",
    label: "Presets",
    color: "#4527a0",
    count: PREDEFINED_PROFILES.length,
  });
  for (const p of PREDEFINED_PROFILES) {
    items.push({ kind: "predefined", profile: p });
  }
  items.push({
    kind: "header",
    label: "Your Profiles",
    color: "#00695c",
    count: profileList.length,
  });
  for (const e of profileList) {
    items.push({ kind: "saved", entry: e });
  }
  return items;
}
