import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
export function Panel({ title, children, borderColor = "#7e57c2", titleColor = "#7e57c2", width, height, flexGrow = 1, focused = false, }) {
    const activeColor = focused ? "#7e57c2" : borderColor;
    return (_jsxs("box", { flexDirection: "column", width: width, height: height, flexGrow: flexGrow, border: true, borderStyle: "single", borderColor: activeColor, padding: 1, children: [title && (_jsx("box", { marginBottom: 0, children: _jsx("text", { fg: titleColor, children: _jsx("strong", { children: title }) }) })), _jsx("box", { flexDirection: "column", flexGrow: 1, children: children })] }));
}
export default Panel;
