import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useDimensions } from "../../state/DimensionsContext.js";
import { TabBar } from "../TabBar.js";
const HEADER_COLOR = "#7e57c2";
export function ScreenLayout({ title, subtitle, currentScreen, search, statusLine, footerHints, listPanel, detailPanel, }) {
    const dimensions = useDimensions();
    const hasSearchBar = search && (search.isActive || search.query);
    // Fixed chrome: top line + tabs + line + header + separator + footer = 6
    // Search bar adds 1 when active
    const fixedHeight = 6 + (hasSearchBar ? 1 : 0);
    const panelHeight = Math.max(5, dimensions.contentHeight - fixedHeight);
    const lineWidth = Math.max(10, dimensions.terminalWidth - 4);
    return (_jsxs("box", { flexDirection: "column", height: dimensions.contentHeight, children: [_jsx("box", { height: 1, paddingLeft: 1, paddingRight: 1, children: _jsx("text", { fg: "#333333", children: "─".repeat(lineWidth) }) }), _jsx("box", { height: 1, paddingLeft: 1, paddingRight: 1, children: _jsx(TabBar, { currentScreen: currentScreen }) }), _jsx("box", { height: 1, paddingLeft: 1, paddingRight: 1, children: _jsx("text", { fg: "#333333", children: "─".repeat(lineWidth) }) }), _jsxs("box", { height: 1, paddingLeft: 1, paddingRight: 1, flexDirection: "row", justifyContent: "space-between", children: [_jsx("text", { fg: HEADER_COLOR, children: _jsx("strong", { children: title }) }), subtitle && _jsx("text", { fg: "gray", children: subtitle }), !subtitle && statusLine ? statusLine : null] }), hasSearchBar && (_jsx("box", { height: 1, paddingLeft: 1, paddingRight: 1, children: search.isActive ? (_jsxs("text", { children: [_jsx("span", { fg: "green", children: "Filter: " }), _jsx("span", { fg: "white", children: search.query }), _jsx("span", { bg: "white", fg: "black", children: " " })] })) : (_jsxs("text", { children: [_jsx("span", { fg: "green", children: "Filter: " }), _jsx("span", { fg: "yellow", children: search.query }), _jsx("span", { fg: "gray", children: "  (Esc to clear)" })] })) })), _jsx("box", { height: 1, paddingLeft: 1, paddingRight: 1, children: _jsx("text", { fg: "#444444", children: "─".repeat(lineWidth) }) }), _jsxs("box", { flexDirection: "row", height: panelHeight, children: [_jsx("box", { flexDirection: "column", width: "49%", height: panelHeight, paddingRight: 1, children: listPanel }), _jsx("box", { flexDirection: "column", width: 1, height: panelHeight, children: _jsx("text", { fg: "#444444", children: "│".repeat(panelHeight) }) }), _jsx("box", { width: "50%", height: panelHeight, paddingLeft: 1, children: _jsx("scrollbox", { height: panelHeight, scrollY: true, scrollX: false, children: _jsx("box", { flexDirection: "column", children: detailPanel }) }) })] }), _jsx("box", { height: 1, paddingLeft: 1, children: _jsx("text", { fg: "gray", children: footerHints }) })] }));
}
export default ScreenLayout;
