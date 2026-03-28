import React from "react";
import type { CliTool } from "../../data/cli-tools.js";
import { theme } from "../theme.js";

// ─── Status type ───────────────────────────────────────────────────────────────

export type InstallMethod = "npm" | "bun" | "pnpm" | "yarn" | "brew" | "pip" | "unknown";

export interface CliToolStatus {
  tool: CliTool;
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  checking: boolean;
  installMethod?: InstallMethod;
  allMethods?: InstallMethod[];
  updateCommand?: string;
  brewFormula?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getUninstallHint(tool: CliTool, method: InstallMethod, brewFormula?: string): string {
  switch (method) {
    case "bun": return `bun remove -g ${tool.packageName}`;
    case "npm": return `npm uninstall -g ${tool.packageName}`;
    case "pnpm": return `pnpm remove -g ${tool.packageName}`;
    case "yarn": return `yarn global remove ${tool.packageName}`;
    case "brew": return `brew uninstall ${brewFormula || tool.name}`;
    case "pip": return `pip uninstall ${tool.packageName}`;
    default: return "";
  }
}

// ─── Row renderer ──────────────────────────────────────────────────────────────

export function renderCliToolRow(
  status: CliToolStatus,
  _index: number,
  isSelected: boolean,
): React.ReactNode {
  const { tool, installed, installedVersion, hasUpdate, checking, allMethods } = status;
  const hasConflict = allMethods && allMethods.length > 1;

  let icon: string;
  let iconColor: string;

  if (!installed) {
    icon = "○";
    iconColor = theme.colors.muted;
  } else if (hasConflict) {
    icon = "!";
    iconColor = theme.colors.danger;
  } else if (hasUpdate) {
    icon = "*";
    iconColor = theme.colors.warning;
  } else {
    icon = "●";
    iconColor = theme.colors.success;
  }

  const versionText = installedVersion ? ` v${installedVersion}` : "";
  const methodTag = installed && allMethods?.length
    ? ` ${allMethods.join("+")}`
    : "";

  if (isSelected) {
    return (
      <text bg={theme.selection.bg} fg={theme.selection.fg}>
        {" "}{icon} {tool.displayName}{versionText}{methodTag}
        {checking ? " ..." : ""}{" "}
      </text>
    );
  }

  return (
    <text>
      <span fg={iconColor}> {icon}</span>
      <span fg={theme.colors.text}> {tool.displayName}</span>
      {versionText ? <span fg={theme.colors.success}>{versionText}</span> : null}
      {methodTag ? <span fg={hasConflict ? theme.colors.danger : theme.colors.dim}>{methodTag}</span> : null}
      {checking ? <span fg={theme.colors.muted}>{" ..."}</span> : null}
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

  const { tool, installed, installedVersion, latestVersion, hasUpdate, checking, installMethod, allMethods, updateCommand, brewFormula } =
    status;

  const hasConflict = allMethods && allMethods.length > 1;

  return (
    <box flexDirection="column">
      <box marginBottom={1}>
        <text fg={theme.colors.info}>
          <strong>{"⚙ "}{tool.displayName}</strong>
        </text>
        {hasUpdate ? <text fg={theme.colors.warning}> ⬆</text> : null}
        {hasConflict ? <text fg={theme.colors.danger}> !</text> : null}
      </box>

      <text fg={theme.colors.muted}>{tool.description}</text>

      <box marginTop={1} flexDirection="column">
        <box>
          <text fg={theme.colors.muted}>{"Status   "}</text>
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
            <text fg={theme.colors.muted}>{"Version  "}</text>
            <text>
              <span fg={theme.colors.success}>v{installedVersion}</span>
              {latestVersion && hasUpdate ? (
                <span fg={theme.colors.warning}> → v{latestVersion}</span>
              ) : null}
            </text>
          </box>
        ) : latestVersion ? (
          <box>
            <text fg={theme.colors.muted}>{"Latest   "}</text>
            <text fg={theme.colors.text}>v{latestVersion}</text>
          </box>
        ) : null}
        {installed && updateCommand ? (
          <box>
            <text fg={theme.colors.muted}>{"Update   "}</text>
            <text fg={theme.colors.accent}>{updateCommand}</text>
          </box>
        ) : !installed ? (
          <box>
            <text fg={theme.colors.muted}>{"Install  "}</text>
            <text fg={theme.colors.accent}>{tool.installCommand}</text>
          </box>
        ) : null}
        <box>
          <text fg={theme.colors.muted}>{"Website  "}</text>
          <text fg={theme.colors.link}>{tool.website}</text>
        </box>
      </box>

      {/* Conflict warning */}
      {hasConflict ? (
        <box marginTop={1} flexDirection="column">
          <box>
            <text bg={theme.colors.danger} fg="white">
              <strong>{" "}Conflict: installed via {allMethods.join(" + ")}{" "}</strong>
            </text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>
              Multiple installs can cause version mismatches.
              {"\n"}Keep one, remove the rest:
            </text>
          </box>
          {allMethods.map((method, i) => (
            <box key={method}>
              <text>
                <span fg={i === 0 ? theme.colors.success : theme.colors.danger}>
                  {i === 0 ? "  ● keep  " : "  ○ remove "}
                </span>
                <span fg={theme.colors.warning}>{method}</span>
                {i > 0 ? (
                  <span fg={theme.colors.dim}>{`  ${getUninstallHint(tool, method, brewFormula)}`}</span>
                ) : (
                  <span fg={theme.colors.dim}>  (active in PATH)</span>
                )}
              </text>
            </box>
          ))}
          <box marginTop={1}>
            <text bg={theme.colors.danger} fg="white">{" "}c{" "}</text>
            <text fg={theme.colors.muted}> Resolve — pick which to keep</text>
          </box>
        </box>
      ) : null}

      {/* Actions */}
      <box marginTop={2} flexDirection="column">
        {!installed ? (
          <box>
            <text bg={theme.colors.success} fg="black">{" "}Enter{" "}</text>
            <text fg={theme.colors.muted}> Install</text>
            <text fg={theme.colors.dim}>  {tool.installCommand}</text>
          </box>
        ) : hasUpdate ? (
          <box>
            <text bg={theme.colors.warning} fg="black">{" "}Enter{" "}</text>
            <text fg={theme.colors.muted}> Update to v{latestVersion}</text>
          </box>
        ) : (
          <box>
            <text bg={theme.colors.muted} fg="white">{" "}Enter{" "}</text>
            <text fg={theme.colors.muted}> Reinstall</text>
          </box>
        )}
      </box>
    </box>
  );
}
