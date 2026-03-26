import React from "react";
import type { McpServer } from "../../types/index.js";
import { theme } from "../theme.js";

// ─── List item types ───────────────────────────────────────────────────────────

export type McpListItem =
  | { kind: "category"; label: string }
  | { kind: "server"; server: McpServer; isInstalled: boolean };

// ─── Row renderers ─────────────────────────────────────────────────────────────

export function renderMcpRow(
  item: McpListItem,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  if (item.kind === "category") {
    return (
      <text fg={theme.selection.bg}>
        <strong>{"▸ "}{item.label}</strong>
      </text>
    );
  }

  const { server, isInstalled } = item;
  const icon = isInstalled ? "●" : "○";
  const iconColor = isInstalled ? theme.colors.success : theme.colors.muted;

  if (isSelected) {
    return (
      <text bg={theme.selection.bg} fg={theme.selection.fg}>
        {" "}
        {icon} {server.name}{" "}
      </text>
    );
  }

  return (
    <text>
      <span fg={iconColor}>{icon}</span>
      <span fg={theme.colors.text}> {server.name}</span>
      {server.requiresConfig ? (
        <span fg={theme.colors.warning}> ⚙</span>
      ) : null}
    </text>
  );
}

// ─── Detail renderer ───────────────────────────────────────────────────────────

export function renderMcpDetail(
  item: McpListItem | undefined,
  loading: boolean,
): React.ReactNode {
  if (loading) {
    return <text fg={theme.colors.muted}>Loading MCP servers...</text>;
  }

  if (!item || item.kind === "category") {
    return (
      <box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      >
        <text fg={theme.colors.muted}>Select a server to see details</text>
      </box>
    );
  }

  const { server, isInstalled } = item;

  return (
    <box flexDirection="column">
      <box marginBottom={1}>
        <text fg={theme.colors.info}>
          <strong>{"⚡ "}{server.name}</strong>
        </text>
        {server.requiresConfig ? (
          <text fg={theme.colors.warning}> ⚙</text>
        ) : null}
      </box>

      <text fg={theme.colors.muted}>{server.description}</text>

      <box marginTop={1} flexDirection="column">
        <box>
          <text fg={theme.colors.muted}>{"Status "}</text>
          {isInstalled ? (
            <text fg={theme.colors.success}>{"● Installed"}</text>
          ) : (
            <text fg={theme.colors.muted}>{"○ Not installed"}</text>
          )}
        </box>
        <box>
          <text fg={theme.colors.muted}>{"Type "}</text>
          <text fg={theme.colors.text}>
            {server.type === "http" ? "HTTP" : "Command"}
          </text>
        </box>
        {server.type === "http" ? (
          <box>
            <text fg={theme.colors.muted}>{"URL "}</text>
            <text fg={theme.colors.link}>{server.url}</text>
          </box>
        ) : (
          <box>
            <text fg={theme.colors.muted}>{"Command "}</text>
            <text fg={theme.colors.info}>{server.command}</text>
          </box>
        )}
        {server.requiresConfig ? (
          <box>
            <text fg={theme.colors.muted}>{"Config "}</text>
            <text fg={theme.colors.warning}>
              {server.configFields?.length ?? 0} fields required
            </text>
          </box>
        ) : null}
      </box>

      <box marginTop={2}>
        {isInstalled ? (
          <box>
            <text bg={theme.colors.danger} fg="white">
              {" "}
              Enter{" "}
            </text>
            <text fg={theme.colors.muted}> Remove server</text>
          </box>
        ) : (
          <box>
            <text bg={theme.colors.success} fg="black">
              {" "}
              Enter{" "}
            </text>
            <text fg={theme.colors.muted}> Install server</text>
          </box>
        )}
      </box>
    </box>
  );
}
