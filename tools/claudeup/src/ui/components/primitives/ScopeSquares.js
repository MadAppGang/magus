import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { theme } from "../../theme.js";
/**
 * Colored filled/empty squares for scope display in list items.
 * ■ = installed in that scope, □ = not installed.
 */
export function ScopeSquares({ user, project, local, selected = false, }) {
    const inactive = selected ? "white" : theme.colors.dim;
    // Returns fragments of <span> — safe to embed inside a <text> parent
    return (_jsxs(_Fragment, { children: [_jsx("span", { fg: user ? theme.scopes.user : inactive, children: "\u25A0" }), _jsx("span", { fg: project ? theme.scopes.project : inactive, children: "\u25A0" }), local !== undefined && (_jsx("span", { fg: local ? theme.scopes.local : inactive, children: "\u25A0" }))] }));
}
