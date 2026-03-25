import React from "react";
import { theme } from "../../theme.js";

export interface Hint {
  key: string;
  label: string;
  tone?: "default" | "primary" | "danger";
}

interface ActionHintsProps {
  hints: Hint[];
}

/**
 * Keyboard shortcut badges for detail panels.
 * Renders: [bg] key [/bg] label
 */
export function ActionHints({ hints }: ActionHintsProps) {
  return (
    <box flexDirection="column" marginTop={1}>
      {hints.map((hint) => (
        <box key={`${hint.key}:${hint.label}`}>
          <text
            bg={
              hint.tone === "danger"
                ? theme.hints.dangerBg
                : hint.tone === "primary"
                  ? theme.hints.primaryBg
                  : theme.hints.defaultBg
            }
            fg="black"
          >
            {" "}
            {hint.key}{" "}
          </text>
          <text fg="gray"> {hint.label}</text>
        </box>
      ))}
    </box>
  );
}
