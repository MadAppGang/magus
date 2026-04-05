import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useKeyboard } from "../../hooks/useKeyboard.js";
export function ConfirmModal({ title, message, onConfirm, onCancel, }) {
    useKeyboard((key) => {
        if (key.name === "y" || key.name === "Y") {
            onConfirm();
        }
        else if (key.name === "n" || key.name === "N" || key.name === "escape") {
            onCancel();
        }
    });
    return (_jsxs("box", { flexDirection: "column", border: true, borderStyle: "rounded", borderColor: "yellow", backgroundColor: "#1a1a2e", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, width: 60, children: [_jsx("text", { children: _jsx("strong", { children: title }) }), _jsx("box", { marginTop: 1, marginBottom: 1, children: _jsx("text", { children: message }) }), _jsx("box", { children: _jsxs("text", { children: [_jsx("span", { fg: "green", children: "[Y]" }), _jsx("span", { children: "es " }), _jsx("span", { fg: "red", children: "[N]" }), _jsx("span", { children: "o" })] }) })] }));
}
export default ConfirmModal;
