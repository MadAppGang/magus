import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { theme } from "../../theme.js";
import { SelectableRow } from "./SelectableRow.js";
export function ListCategoryRow({ title, expanded = false, count, badge, tone = "gray", selected, }) {
    const colors = theme.category[tone];
    const label = `${expanded ? "▼" : "▶"} ${title}${count !== undefined ? ` (${count})` : ""}`;
    return (_jsxs(SelectableRow, { selected: selected, children: [!selected && (_jsx("span", { bg: colors.bg, fg: colors.fg, children: _jsxs("strong", { children: [" ", label, " "] }) })), selected && _jsxs("strong", { children: [" ", label, " "] }), !selected && badge ? (_jsxs("span", { fg: colors.badgeFg, children: [" ", badge] })) : null] }));
}
