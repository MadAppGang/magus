import React from "react";
import { theme } from "../../theme.js";

interface ScopeSquaresProps {
  user: boolean;
  project: boolean;
  local?: boolean;
  selected?: boolean;
}

/**
 * Colored filled/empty squares for scope display in list items.
 * ■ = installed in that scope, □ = not installed.
 */
export function ScopeSquares({
  user,
  project,
  local,
  selected = false,
}: ScopeSquaresProps) {
  const inactive = selected ? "white" : theme.colors.dim;

  // Returns fragments of <span> — safe to embed inside a <text> parent
  return (
    <>
      <span fg={user ? theme.scopes.user : inactive}>■</span>
      <span fg={project ? theme.scopes.project : inactive}>■</span>
      {local !== undefined && (
        <span fg={local ? theme.scopes.local : inactive}>■</span>
      )}
    </>
  );
}
