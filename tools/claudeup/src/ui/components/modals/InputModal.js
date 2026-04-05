import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useState } from "react";
import { useKeyboard } from "../../hooks/useKeyboard.js";
export function InputModal({ title, label, defaultValue = "", onSubmit, onCancel, }) {
    const [value, setValue] = useState(defaultValue);
    useKeyboard((key) => {
        if (key.name === "enter") {
            onSubmit(value);
        }
        else if (key.name === "escape") {
            onCancel();
        }
    });
    return (_jsxs("box", { flexDirection: "column", border: true, borderStyle: "rounded", borderColor: "cyan", backgroundColor: "#1a1a2e", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, width: 60, children: [_jsx("text", { children: _jsx("strong", { children: title }) }), _jsx("box", { marginTop: 1, marginBottom: 1, children: _jsx("text", { children: label }) }), _jsx("input", { value: value, onChange: setValue, focused: true, width: 54 }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "#666666", children: "Enter to confirm \u2022 Escape to cancel" }) })] }));
}
export default InputModal;
