import React from "react";

interface DetailSectionProps {
  title?: string;
  children: React.ReactNode;
}

/**
 * A labeled section in a detail panel with optional title header.
 */
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <box flexDirection="column" marginTop={1}>
      {title ? (
        <text fg="cyan">
          <strong>{title}</strong>
        </text>
      ) : null}
      {children}
    </box>
  );
}
