import React from "react";
import { theme } from "../../theme.js";

interface SelectableRowProps {
  selected: boolean;
  indent?: number;
  children: React.ReactNode;
}

export function SelectableRow({
  selected,
  indent = 0,
  children,
}: SelectableRowProps) {
  return (
    <text
      bg={selected ? theme.selection.bg : undefined}
      fg={selected ? theme.selection.fg : undefined}
    >
      {" ".repeat(indent)}
      {children}
    </text>
  );
}
