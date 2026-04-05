import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { theme } from "../../theme.js";
/**
 * The u/p/l badges used in detail panels.
 * Renders each scope as: [bg=color] key [/bg] ● or ○ Label path
 */
export function ScopeDetail({ scopes, paths }) {
    const items = [
        {
            key: "u",
            label: "User",
            color: theme.scopes.user,
            active: scopes.user,
            path: paths?.user,
        },
        {
            key: "p",
            label: "Project",
            color: theme.scopes.project,
            active: scopes.project,
            path: paths?.project,
        },
        {
            key: "l",
            label: "Local",
            color: theme.scopes.local,
            active: scopes.local,
            path: paths?.local,
        },
    ].filter((i) => i.path !== undefined || i.active !== undefined);
    return (_jsx("box", { flexDirection: "column", children: items.map((item) => (_jsxs("text", { children: [_jsxs("span", { bg: item.color, fg: "black", children: [" ", item.key, " "] }), _jsx("span", { fg: item.active ? item.color : "gray", children: item.active ? " ● " : " ○ " }), _jsx("span", { fg: item.color, children: item.label }), item.path && _jsxs("span", { fg: "gray", children: [" ", item.path] })] }, item.key))) }));
}
