import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { theme } from "../../theme.js";
/**
 * Keyboard shortcut badges for detail panels.
 * Renders: [bg] key [/bg] label
 */
export function ActionHints({ hints }) {
    return (_jsx("box", { flexDirection: "column", marginTop: 1, children: hints.map((hint) => (_jsxs("box", { children: [_jsxs("text", { bg: hint.tone === "danger"
                        ? theme.hints.dangerBg
                        : hint.tone === "primary"
                            ? theme.hints.primaryBg
                            : theme.hints.defaultBg, fg: "black", children: [" ", hint.key, " "] }), _jsxs("text", { fg: "gray", children: [" ", hint.label] })] }, `${hint.key}:${hint.label}`))) }));
}
