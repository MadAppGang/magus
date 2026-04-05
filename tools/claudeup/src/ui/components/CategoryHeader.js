import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
export function CategoryHeader({ title, status, statusColor = "green", expanded = true, count, }) {
    const expandIcon = expanded ? "▼" : "▶";
    const countBadge = count !== undefined ? ` (${count})` : "";
    const statusText = status ? ` ${status}` : "";
    // Simple format without dynamic line calculation
    return (_jsxs("text", { children: [_jsx("span", { fg: "#666666", children: expandIcon }), _jsx("span", { fg: "white", children: _jsxs("strong", { children: [" ", title] }) }), _jsx("span", { fg: "#666666", children: countBadge }), _jsx("span", { fg: "#666666", children: " \u2500\u2500\u2500\u2500" }), _jsx("span", { fg: statusColor, children: statusText })] }));
}
export default CategoryHeader;
