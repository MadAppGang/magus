import { jsx as _jsx } from "@opentui/react/jsx-runtime";
import { theme } from "../../theme.js";
/**
 * Subdued text for versions, stars, status indicators.
 */
export function MetaText({ text, tone = "muted" }) {
    return _jsx("span", { fg: theme.meta[tone], children: text });
}
