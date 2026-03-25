import React from "react";

interface KeyValueLineProps {
  label: string;
  value: React.ReactNode;
}

/**
 * Aligned label-value pair for detail panels.
 * Label is padded to 10 chars for consistent alignment.
 */
export function KeyValueLine({ label, value }: KeyValueLineProps) {
  return (
    <text>
      <span fg="gray">{label.padEnd(10)}</span>
      {value}
    </text>
  );
}
