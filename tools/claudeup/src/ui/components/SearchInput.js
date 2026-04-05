import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useKeyboardHandler } from "../hooks/useKeyboardHandler.js";
export function SearchInput({ value, onChange, placeholder = "Search...", isActive, onExit, onSubmit, }) {
    // Handle keyboard shortcuts when active
    useKeyboardHandler((_input, key) => {
        if (!isActive)
            return;
        if (key.escape) {
            onExit?.();
            return;
        }
        if (key.return) {
            onSubmit?.();
            return;
        }
    });
    return (_jsxs("box", { flexDirection: "row", children: [_jsx("text", { fg: "cyan", children: "\u276F " }), _jsx("input", { value: value, onChange: onChange, placeholder: placeholder, focused: isActive, width: 40 })] }));
}
export default SearchInput;
