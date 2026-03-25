import React from "react";
import { theme } from "../../theme.js";
import { SelectableRow } from "./SelectableRow.js";

interface ListCategoryRowProps {
  title: string;
  expanded?: boolean;
  count?: number;
  badge?: string;
  tone?: keyof typeof theme.category;
  selected: boolean;
}

export function ListCategoryRow({
  title,
  expanded = false,
  count,
  badge,
  tone = "gray",
  selected,
}: ListCategoryRowProps) {
  const colors = theme.category[tone];
  const label = `${expanded ? "▼" : "▶"} ${title}${count !== undefined ? ` (${count})` : ""}`;

  return (
    <SelectableRow selected={selected}>
      {!selected && (
        <span bg={colors.bg} fg={colors.fg}>
          <strong> {label} </strong>
        </span>
      )}
      {selected && <strong> {label} </strong>}
      {!selected && badge ? (
        <span fg={colors.badgeFg}> {badge}</span>
      ) : null}
    </SelectableRow>
  );
}
