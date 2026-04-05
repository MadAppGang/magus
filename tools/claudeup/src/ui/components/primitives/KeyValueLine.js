import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
/**
 * Aligned label-value pair for detail panels.
 * Label is padded to 10 chars for consistent alignment.
 */
export function KeyValueLine({ label, value }) {
    return (_jsxs("text", { children: [_jsx("span", { fg: "gray", children: label.padEnd(10) }), value] }));
}
