import { jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { theme } from "../../theme.js";
export function SelectableRow({ selected, indent = 0, children, }) {
    return (_jsxs("text", { bg: selected ? theme.selection.bg : undefined, fg: selected ? theme.selection.fg : undefined, children: [" ".repeat(indent), children] }));
}
