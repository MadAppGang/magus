import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
export function ProgressBar({ message, current, total }) {
    const isDeterminate = current !== undefined && total !== undefined && total > 0;
    if (isDeterminate) {
        const barWidth = 20;
        const filled = Math.round((current / total) * barWidth);
        const empty = barWidth - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        return (_jsxs("box", { children: [_jsx("text", { fg: "cyan", children: "\u27F3" }), _jsxs("text", { children: [" ", message, " "] }), _jsxs("text", { fg: "cyan", children: ["[", bar, "] ", current, "/", total] })] }));
    }
    // Indeterminate progress
    return (_jsxs("box", { children: [_jsx("text", { fg: "cyan", children: "\u27F3" }), _jsxs("text", { children: [" ", message] }), _jsx("text", { fg: "gray", children: " ..." })] }));
}
export default ProgressBar;
