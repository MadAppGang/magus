import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useState, useEffect } from "react";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function LoadingModal({ message }) {
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        const interval = setInterval(() => {
            setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
        }, 80);
        return () => clearInterval(interval);
    }, []);
    return (_jsxs("box", { flexDirection: "row", border: true, borderStyle: "rounded", borderColor: "cyan", backgroundColor: "#1a1a2e", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, children: [_jsx("text", { fg: "cyan", children: SPINNER_FRAMES[frame] }), _jsxs("text", { children: [" ", message] })] }));
}
export default LoadingModal;
