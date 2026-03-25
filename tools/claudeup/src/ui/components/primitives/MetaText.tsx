import React from "react";
import { theme } from "../../theme.js";

interface MetaTextProps {
  text: string;
  tone?: "muted" | "warning" | "success" | "danger";
}

/**
 * Subdued text for versions, stars, status indicators.
 */
export function MetaText({ text, tone = "muted" }: MetaTextProps) {
  return <span fg={theme.meta[tone]}>{text}</span>;
}
