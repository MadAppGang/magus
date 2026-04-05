import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
/**
 * A labeled section in a detail panel with optional title header.
 */
export function DetailSection({ title, children }) {
    return (_jsxs("box", { flexDirection: "column", marginTop: 1, children: [title ? (_jsx("text", { fg: "cyan", children: _jsx("strong", { children: title }) })) : null, children] }));
}
