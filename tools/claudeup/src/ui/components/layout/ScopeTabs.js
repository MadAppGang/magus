import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
export function ScopeTabs({ scope, onToggle: _onToggle, toggleHint, }) {
    const isProject = scope === "project";
    return (_jsxs("box", { marginBottom: 1, flexDirection: "row", gap: 1, children: [_jsx("box", { children: isProject ? (_jsx("text", { bg: "cyan", fg: "black", children: _jsx("strong", { children: " \u25C6 Project " }) })) : (_jsx("text", { fg: "gray", children: " \u25CB Project " })) }), _jsx("box", { children: !isProject ? (_jsx("text", { bg: "magenta", fg: "white", children: _jsx("strong", { children: " \u25C6 Global " }) })) : (_jsx("text", { fg: "gray", children: " \u25CB Global " })) }), toggleHint && (_jsx("box", { marginLeft: 2, children: _jsxs("text", { fg: "#666666", children: ["(", toggleHint, ")"] }) }))] }));
}
export default ScopeTabs;
