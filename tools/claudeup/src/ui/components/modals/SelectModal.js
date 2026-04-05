import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
export function SelectModal({ title, message, options, defaultIndex, onSelect: _onSelect, onCancel: _onCancel, }) {
    // Keyboard handling is done by ModalContainer
    // defaultIndex is the live selectedIndex from ModalContainer state
    const selectedIndex = defaultIndex ?? 0;
    return (_jsxs("box", { flexDirection: "column", border: true, borderStyle: "rounded", borderColor: "cyan", backgroundColor: "#1a1a2e", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, width: 50, children: [_jsx("text", { children: _jsx("strong", { children: title }) }), _jsx("box", { marginTop: 1, marginBottom: 1, children: _jsx("text", { children: message }) }), _jsx("box", { flexDirection: "column", children: options.map((option, idx) => {
                    const isSelected = idx === selectedIndex;
                    const label = isSelected ? `> ${option.label}` : `  ${option.label}`;
                    return (_jsxs("text", { fg: isSelected ? "cyan" : "#666666", children: [isSelected && _jsx("strong", { children: label }), !isSelected && label] }, option.value));
                }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "#666666", children: "\u2191\u2193 Select \u2022 Enter \u2022 Esc" }) })] }));
}
export default SelectModal;
