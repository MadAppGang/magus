import React from "react";
import { theme } from "../../theme.js";

interface ScopeDetailScope {
  user?: boolean;
  project?: boolean;
  local?: boolean;
}

interface ScopeDetailPaths {
  user?: string;
  project?: string;
  local?: string;
}

interface ScopeDetailProps {
  scopes: ScopeDetailScope;
  paths?: ScopeDetailPaths;
}

/**
 * The u/p/l badges used in detail panels.
 * Renders each scope as: [bg=color] key [/bg] ● or ○ Label path
 */
export function ScopeDetail({ scopes, paths }: ScopeDetailProps) {
  const items = [
    {
      key: "u",
      label: "User",
      color: theme.scopes.user,
      active: scopes.user,
      path: paths?.user,
    },
    {
      key: "p",
      label: "Project",
      color: theme.scopes.project,
      active: scopes.project,
      path: paths?.project,
    },
    {
      key: "l",
      label: "Local",
      color: theme.scopes.local,
      active: scopes.local,
      path: paths?.local,
    },
  ].filter((i) => i.path !== undefined || i.active !== undefined);

  return (
    <box flexDirection="column">
      {items.map((item) => (
        <text key={item.key}>
          <span bg={item.color} fg="black">
            {" "}
            {item.key}{" "}
          </span>
          <span fg={item.active ? item.color : "gray"}>
            {item.active ? " ● " : " ○ "}
          </span>
          <span fg={item.color}>{item.label}</span>
          {item.path && <span fg="gray"> {item.path}</span>}
        </text>
      ))}
    </box>
  );
}
