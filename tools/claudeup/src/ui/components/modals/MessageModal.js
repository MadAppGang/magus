import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { useKeyboard } from "../../hooks/useKeyboard.js";
const variantConfig = {
    info: { icon: "ℹ", color: "cyan" },
    success: { icon: "✓", color: "green" },
    error: { icon: "✗", color: "red" },
};
export function MessageModal({ title, message, variant, onDismiss, }) {
    const config = variantConfig[variant];
    useKeyboard(() => {
        // Any key dismisses
        onDismiss();
    });
    return (_jsxs("box", { flexDirection: "column", border: true, borderStyle: "rounded", borderColor: config.color, backgroundColor: "#1a1a2e", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, width: 60, children: [_jsxs("box", { children: [_jsxs("text", { fg: config.color, children: [config.icon, " "] }), _jsx("text", { children: _jsx("strong", { children: title }) })] }), _jsx("box", { marginTop: 1, marginBottom: 1, children: _jsx("text", { children: message }) }), _jsx("box", { children: _jsx("text", { fg: "#666666", children: "Press any key to continue" }) })] }));
}
export default MessageModal;
