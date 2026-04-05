import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { useKeyboardHandler } from "../hooks/useKeyboardHandler";
const TABS = [
    { key: "1", label: "Plugins", screen: "plugins" },
    { key: "2", label: "Skills", screen: "skills" },
    { key: "3", label: "MCP", screen: "mcp" },
    { key: "4", label: "Settings", screen: "settings" },
    { key: "5", label: "Profiles", screen: "profiles" },
    { key: "6", label: "CLI", screen: "cli-tools" },
];
export function TabBar({ currentScreen, onTabChange }) {
    // Handle number key shortcuts (1-5)
    useKeyboardHandler((input, key) => {
        if (!onTabChange)
            return;
        // Number keys 1-5
        const tabIndex = Number.parseInt(input, 10);
        if (tabIndex >= 1 && tabIndex <= TABS.length) {
            const tab = TABS[tabIndex - 1];
            if (tab && tab.screen !== currentScreen) {
                onTabChange(tab.screen);
            }
        }
        // Tab key to cycle through tabs
        if (key.tab) {
            const currentIndex = TABS.findIndex((t) => t.screen === currentScreen);
            const nextIndex = key.shift
                ? (currentIndex - 1 + TABS.length) % TABS.length
                : (currentIndex + 1) % TABS.length;
            onTabChange(TABS[nextIndex].screen);
        }
    });
    return (_jsx("box", { flexDirection: "row", gap: 0, children: TABS.map((tab, index) => {
            const isSelected = tab.screen === currentScreen;
            const isLast = index === TABS.length - 1;
            return (_jsxs("box", { flexDirection: "row", children: [isSelected ? (_jsx("box", { children: _jsx("text", { bg: "#7e57c2", fg: "white", children: _jsxs("strong", { children: [" ", tab.key, ":", tab.label, " "] }) }) })) : (_jsx("box", { children: _jsxs("text", { fg: "gray", children: [" ", tab.key, ":", tab.label, " "] }) })), !isLast && _jsx("text", { fg: "#666666", children: "\u2502" })] }, tab.key));
        }) }));
}
export default TabBar;
