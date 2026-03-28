import React from "react";
import type { CliTool } from "../../data/cli-tools.js";
import { theme } from "../theme.js";

// ─── Status type ───────────────────────────────────────────────────────────────

export interface CliToolStatus {
  tool: CliTool;
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  checking: boolean;
}

// ─── Row renderer ──────────────────────────────────────────────────────────────

export function renderCliToolRow(
  status: CliToolStatus,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  const { tool, installed, installedVersion, hasUpdate, checking } = status;

  let icon: string;
  let iconColor: string;

  if (!installed) {
    icon = "○";
    iconColor = theme.colors.muted;
  } else if (hasUpdate) {
    icon = "⬆";
    iconColor = theme.colors.warning;
  } else {
    icon = "●";
    iconColor = theme.colors.success;
  }

  const versionText = installedVersion ? `v${installedVersion}` : "";

  if (isSelected) {
    return (
      <text bg={theme.selection.bg} fg={theme.selection.fg}>
        {" "}
        {icon} {tool.displayName} {versionText}
        {checking ? "..." : ""}{" "}
      </text>
    );
  }

  return (
    <text>
      <span fg={iconColor}>{icon}</span>
      <span fg={theme.colors.text}> {tool.displayName}</span>
      {versionText ? <span fg={theme.colors.success}> {versionText}</span> : null}
      {checking ? <span fg={theme.colors.muted}>{"..."}</span> : null}
    </text>
  );
}

// ─── Detail renderer ───────────────────────────────────────────────────────────

export function renderCliToolDetail(
  status: CliToolStatus | undefined,
): React.ReactNode {
  if (!status) {
    return (
      <box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      >
        <text fg={theme.colors.muted}>Select a tool to see details</text>
      </box>
    );
  }

  const { tool, installed, installedVersion, latestVersion, hasUpdate, checking } =
    status;

  return (
    <box flexDirection="column">
      <box marginBottom={1}>
        <text fg={theme.colors.info}>
          <strong>{"⚙ "}{tool.displayName}</strong>
        </text>
        {hasUpdate ? <text fg={theme.colors.warning}> ⬆</text> : null}
      </box>

      <text fg={theme.colors.muted}>{tool.description}</text>

      <box marginTop={1} flexDirection="column">
        <box>
          <text fg={theme.colors.muted}>{"Status "}</text>
          {!installed ? (
            <text fg={theme.colors.muted}>{"○ Not installed"}</text>
          ) : checking ? (
            <text fg={theme.colors.success}>{"● Checking..."}</text>
          ) : hasUpdate ? (
            <text fg={theme.colors.warning}>{"● Update available"}</text>
          ) : (
            <text fg={theme.colors.success}>{"● Up to date"}</text>
          )}
        </box>
        {installedVersion ? (
          <box>
            <text fg={theme.colors.muted}>{"Installed "}</text>
            <text fg={theme.colors.success}>v{installedVersion}</text>
          </box>
        ) : null}
        {latestVersion ? (
          <box>
            <text fg={theme.colors.muted}>{"Latest "}</text>
            <text fg={theme.colors.text}>v{latestVersion}</text>
          </box>
        ) : null}
        <box>
          <text fg={theme.colors.muted}>{"Package "}</text>
          <text fg={theme.colors.text}>{tool.packageName}</text>
        </box>
        <box>
          <text fg={theme.colors.muted}>{"Install "}</text>
          <text fg={theme.colors.accent}>{tool.installCommand}</text>
        </box>
        <box>
          <text fg={theme.colors.muted}>{"Website "}</text>
          <text fg={theme.colors.link}>{tool.website}</text>
        </box>
      </box>

      <box marginTop={2}>
        {!installed ? (
          <box>
            <text bg={theme.colors.success} fg="black">
              {" "}
              Enter{" "}
            </text>
            <text fg={theme.colors.muted}> Install</text>
          </box>
        ) : hasUpdate ? (
          <box>
            <text bg={theme.colors.warning} fg="black">
              {" "}
              Enter{" "}
            </text>
            <text fg={theme.colors.muted}> Update to v{latestVersion}</text>
          </box>
        ) : (
          <box>
            <text bg={theme.colors.muted} fg="white">
              {" "}
              Enter{" "}
            </text>
            <text fg={theme.colors.muted}> Reinstall</text>
          </box>
        )}
      </box>
    </box>
  );
}
