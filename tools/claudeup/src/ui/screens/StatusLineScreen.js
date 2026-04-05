import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/react/jsx-runtime";
import { useEffect, useCallback, useState } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { statusLineCategories } from "../../data/statuslines.js";
import { setStatusLine, getStatusLine, setGlobalStatusLine, getGlobalStatusLine, } from "../../services/claude-settings.js";
export function StatusLineScreen() {
    const { state, dispatch } = useApp();
    const { statusline: statusLine } = state;
    const modal = useModal();
    const dimensions = useDimensions();
    const [projectStatusLine, setProjectStatusLineState] = useState();
    const [globalStatusLine, setGlobalStatusLineState] = useState();
    const [isLoading, setIsLoading] = useState(true);
    // Fetch data
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [project, global] = await Promise.all([
                getStatusLine(state.projectPath),
                getGlobalStatusLine(),
            ]);
            setProjectStatusLineState(project);
            setGlobalStatusLineState(global);
        }
        catch (error) {
            // Silent error handling - show empty state
        }
        setIsLoading(false);
    }, [state.projectPath]);
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    // Get current status line based on scope
    const getCurrentStatusLine = () => {
        return statusLine.scope === "project"
            ? projectStatusLine
            : globalStatusLine;
    };
    // Build list items with categories
    const buildListItems = () => {
        const currentForScope = getCurrentStatusLine();
        const items = [];
        for (const category of statusLineCategories) {
            items.push({
                label: category.name,
                isCategory: true,
            });
            for (const preset of category.presets) {
                const isActive = currentForScope === preset.template;
                const status = isActive ? "●" : "○";
                items.push({
                    label: `  ${status} ${preset.name}`,
                    preset,
                });
            }
        }
        // Add custom option at the end
        items.push({
            label: "+ Custom Status Line",
            isCustom: true,
        });
        return items;
    };
    const listItems = buildListItems();
    // Keyboard handling
    useKeyboard((event) => {
        if (state.isSearching || state.modal)
            return;
        if (event.name === "up" || event.name === "k") {
            const newIndex = Math.max(0, statusLine.selectedIndex - 1);
            dispatch({ type: "STATUSLINE_SELECT", index: newIndex });
        }
        else if (event.name === "down" || event.name === "j") {
            const newIndex = Math.min(listItems.length - 1, statusLine.selectedIndex + 1);
            dispatch({ type: "STATUSLINE_SELECT", index: newIndex });
        }
        else if (event.name === "p") {
            dispatch({ type: "STATUSLINE_SET_SCOPE", scope: "project" });
        }
        else if (event.name === "g") {
            dispatch({ type: "STATUSLINE_SET_SCOPE", scope: "global" });
        }
        else if (event.name === "r") {
            handleReset();
        }
        else if (event.name === "enter") {
            handleSelect();
        }
    });
    const saveStatusLine = async (template) => {
        if (statusLine.scope === "global") {
            await setGlobalStatusLine(template);
        }
        else {
            await setStatusLine(template, state.projectPath);
        }
    };
    const handleSelect = async () => {
        const item = listItems[statusLine.selectedIndex];
        if (!item || item.isCategory)
            return;
        const scopeLabel = statusLine.scope === "global" ? "Global" : "Project";
        if (item.isCustom) {
            const template = await modal.input(`Custom Status Line (${scopeLabel})`, "Enter template (use {model}, {cost}, etc.):", getCurrentStatusLine() || "");
            if (template !== null) {
                modal.loading(`Saving custom status line...`);
                try {
                    await saveStatusLine(template);
                    modal.hideModal();
                    await modal.message("Saved", `Custom status line saved to ${scopeLabel}.\n\nRestart Claude Code to apply changes.`, "success");
                    fetchData();
                }
                catch (error) {
                    modal.hideModal();
                    await modal.message("Error", `Failed to save: ${error}`, "error");
                }
            }
        }
        else if (item.preset) {
            modal.loading(`Applying ${item.preset.name}...`);
            try {
                await saveStatusLine(item.preset.template);
                modal.hideModal();
                await modal.message("Applied", `"${item.preset.name}" applied to ${scopeLabel}.\n\nRestart Claude Code to apply changes.`, "success");
                fetchData();
            }
            catch (error) {
                modal.hideModal();
                await modal.message("Error", `Failed to apply: ${error}`, "error");
            }
        }
    };
    const handleReset = async () => {
        const scopeLabel = statusLine.scope === "global" ? "Global" : "Project";
        const confirmed = await modal.confirm("Reset Status Line", `Clear the ${scopeLabel} status line configuration?`);
        if (confirmed) {
            modal.loading("Resetting...");
            try {
                await saveStatusLine("");
                modal.hideModal();
                await modal.message("Reset", `${scopeLabel} status line has been cleared.`, "success");
                fetchData();
            }
            catch (error) {
                modal.hideModal();
                await modal.message("Error", `Failed to reset: ${error}`, "error");
            }
        }
    };
    // Get selected item
    const selectedItem = listItems[statusLine.selectedIndex];
    // Build preview
    const renderPreview = () => {
        if (isLoading) {
            return _jsx("text", { fg: "gray", children: "Loading status line settings..." });
        }
        if (!selectedItem || selectedItem.isCategory) {
            return (_jsx("box", { flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, children: _jsx("text", { fg: "gray", children: "Select a theme to see preview" }) }));
        }
        if (selectedItem.isCustom) {
            return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: "cyan", children: _jsx("strong", { children: "\u2728 Custom Status Line" }) }), _jsx("text", { fg: "gray", children: "Create your own unique status line!" }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsx("text", { fg: "yellow", children: _jsx("strong", { children: "Available variables:" }) }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("text", { children: [_jsx("span", { fg: "green", children: _jsx("strong", { children: "{model}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Model name"] }), _jsxs("text", { children: [_jsx("span", { fg: "green", children: _jsx("strong", { children: "{model_short}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Short name"] }), _jsxs("text", { children: [_jsx("span", { fg: "yellow", children: _jsx("strong", { children: "{cost}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Session cost"] }), _jsxs("text", { children: [_jsx("span", { fg: "#5c9aff", children: _jsx("strong", { children: "{cwd}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Working directory"] }), _jsxs("text", { children: [_jsx("span", { fg: "magenta", children: _jsx("strong", { children: "{git_branch}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Git branch"] }), _jsxs("text", { children: [_jsx("span", { fg: "cyan", children: _jsx("strong", { children: "{input_tokens}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Input tokens"] }), _jsxs("text", { children: [_jsx("span", { fg: "cyan", children: _jsx("strong", { children: "{output_tokens}" }) }), " ", _jsx("span", { fg: "gray", children: "\u2192" }), " Output tokens"] }), _jsxs("text", { children: [_jsx("span", { fg: "red", children: _jsx("strong", { children: "{session_duration}" }) }), _jsx("span", { fg: "gray", children: "\u2192" }), " Duration"] })] })] })] }));
        }
        if (selectedItem.preset) {
            const example = selectedItem.preset.template
                .replace("{model}", "claude-sonnet-4")
                .replace("{model_short}", "sonnet")
                .replace("{cost}", "0.42")
                .replace("{cwd}", "~/myapp")
                .replace("{git_branch}", "main")
                .replace("{input_tokens}", "1.2k")
                .replace("{output_tokens}", "850")
                .replace("{session_duration}", "12m");
            return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: "cyan", children: _jsxs("strong", { children: ["\u25C6 ", selectedItem.preset.name] }) }), _jsx("text", { fg: "gray", children: selectedItem.preset.description }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsx("text", { fg: "yellow", children: _jsx("strong", { children: "Preview:" }) }), _jsx("box", { marginTop: 1, paddingLeft: 1, paddingRight: 1, borderStyle: "rounded", borderColor: "green", children: _jsx("text", { fg: "white", children: example }) })] }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsx("text", { fg: "#666666", children: "Template:" }), _jsx("text", { fg: "gray", children: selectedItem.preset.template })] })] }));
        }
        return null;
    };
    const renderListItem = (item, _idx, isSelected) => {
        if (item.isCategory) {
            return (_jsx("text", { fg: "magenta", children: _jsxs("strong", { children: ["\u25B8 ", item.label] }) }));
        }
        if (item.isCustom) {
            return isSelected ? (_jsx("text", { bg: "cyan", fg: "black", children: _jsx("strong", { children: " \u2795 Custom Status Line " }) })) : (_jsx("text", { fg: "cyan", children: _jsxs("strong", { children: ["  ", "\u2795 Custom Status Line"] }) }));
        }
        const currentForScope = getCurrentStatusLine();
        const isActive = item.preset && currentForScope === item.preset.template;
        return isSelected ? (_jsxs("text", { bg: "magenta", fg: "white", children: [" ", isActive ? "●" : "○", " ", item.preset?.name || "", " "] })) : (_jsxs("text", { fg: isActive ? "green" : "white", children: ["  ", isActive ? "●" : "○", " ", item.preset?.name || ""] }));
    };
    // Build status line content
    const scopeLabel = statusLine.scope === "project" ? "Project" : "Global";
    const currentValue = getCurrentStatusLine();
    const statusContent = (_jsxs(_Fragment, { children: [_jsx("text", { fg: "gray", children: "Scope: " }), _jsx("text", { fg: "cyan", children: scopeLabel }), _jsx("text", { fg: "gray", children: " \u2502 Current: " }), _jsx("text", { fg: "green", children: currentValue
                    ? currentValue.slice(0, 35) + (currentValue.length > 35 ? "..." : "")
                    : "(not set)" })] }));
    return (_jsx(ScreenLayout, { title: "claudeup Status Line", currentScreen: "statusline", statusLine: statusContent, footerHints: "\u2191\u2193:nav \u2502 Enter:apply \u2502 p:project \u2502 g:global \u2502 r:reset", listPanel: _jsx(ScrollableList, { items: listItems, selectedIndex: statusLine.selectedIndex, renderItem: renderListItem, maxHeight: dimensions.listPanelHeight }), detailPanel: renderPreview() }));
}
export default StatusLineScreen;
