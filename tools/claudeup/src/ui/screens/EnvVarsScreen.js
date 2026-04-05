import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useCallback, useMemo } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { SETTINGS_CATALOG, } from "../../data/settings-catalog.js";
import { readAllSettingsBothScopes, writeSettingValue, } from "../../services/settings-manager.js";
import { buildSettingsBrowserItems, } from "../adapters/settingsAdapter.js";
import { renderSettingRow, renderSettingDetail } from "../renderers/settingsRenderers.js";
export function SettingsScreen() {
    const { state, dispatch } = useApp();
    const { settings } = state;
    const modal = useModal();
    const dimensions = useDimensions();
    const fetchData = useCallback(async () => {
        dispatch({ type: "SETTINGS_DATA_LOADING" });
        try {
            const values = await readAllSettingsBothScopes(SETTINGS_CATALOG, state.projectPath);
            dispatch({ type: "SETTINGS_DATA_SUCCESS", values });
        }
        catch (error) {
            dispatch({
                type: "SETTINGS_DATA_ERROR",
                error: error instanceof Error ? error : new Error(String(error)),
            });
        }
    }, [dispatch, state.projectPath]);
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    const listItems = useMemo(() => {
        if (settings.values.status !== "success")
            return [];
        return buildSettingsBrowserItems(settings.values.data);
    }, [settings.values]);
    const handleScopeChange = async (scope) => {
        const item = listItems[settings.selectedIndex];
        if (!item || item.kind !== "setting")
            return;
        const { setting, scopedValues } = item;
        const currentValue = scope === "user" ? scopedValues.user : scopedValues.project;
        if (setting.type === "boolean") {
            const currentBool = currentValue === "true" ||
                currentValue === "1" ||
                (currentValue === undefined && setting.defaultValue === "true");
            const newValue = currentBool ? "false" : "true";
            try {
                await writeSettingValue(setting, newValue, scope, state.projectPath);
                await fetchData();
            }
            catch (error) {
                await modal.message("Error", `Failed to update: ${error}`, "error");
            }
        }
        else if (setting.type === "select" && setting.options) {
            const options = setting.options.map((o) => ({
                label: o.label + (currentValue === o.value ? " (current)" : ""),
                value: o.value,
            }));
            const currentIndex = setting.options.findIndex((o) => o.value === currentValue);
            if (currentValue !== undefined) {
                options.push({ label: "Clear (use default)", value: "__clear__" });
            }
            const selected = await modal.select(`${setting.name} — ${scope}`, setting.description, options, currentIndex >= 0 ? currentIndex : undefined);
            if (selected === null)
                return;
            try {
                const val = selected === "__clear__" ? undefined : selected || undefined;
                await writeSettingValue(setting, val, scope, state.projectPath);
                await fetchData();
            }
            catch (error) {
                await modal.message("Error", `Failed to update: ${error}`, "error");
            }
        }
        else {
            const newValue = await modal.input(`${setting.name} — ${scope}`, setting.description, currentValue || "");
            if (newValue === null)
                return;
            try {
                await writeSettingValue(setting, newValue || undefined, scope, state.projectPath);
                await fetchData();
            }
            catch (error) {
                await modal.message("Error", `Failed to update: ${error}`, "error");
            }
        }
    };
    useKeyboard((event) => {
        if (state.isSearching || state.modal)
            return;
        if (event.name === "up" || event.name === "k") {
            const newIndex = Math.max(0, settings.selectedIndex - 1);
            dispatch({ type: "SETTINGS_SELECT", index: newIndex });
        }
        else if (event.name === "down" || event.name === "j") {
            const newIndex = Math.min(Math.max(0, listItems.length - 1), settings.selectedIndex + 1);
            dispatch({ type: "SETTINGS_SELECT", index: newIndex });
        }
        else if (event.name === "u") {
            handleScopeChange("user");
        }
        else if (event.name === "p") {
            handleScopeChange("project");
        }
        else if (event.name === "enter") {
            handleScopeChange("project");
        }
    });
    const selectedItem = listItems[settings.selectedIndex];
    const renderDetail = () => {
        if (settings.values.status === "loading") {
            return _jsx("text", { fg: "gray", children: "Loading settings..." });
        }
        if (settings.values.status === "error") {
            return _jsx("text", { fg: "red", children: "Failed to load settings" });
        }
        return renderSettingDetail(selectedItem);
    };
    const totalSet = settings.values.status === "success"
        ? Array.from(settings.values.data.values()).filter((v) => v.user !== undefined || v.project !== undefined).length
        : 0;
    const statusContent = (_jsxs("text", { children: [_jsx("span", { fg: "gray", children: "Settings: " }), _jsxs("span", { fg: "cyan", children: [totalSet, " configured"] }), _jsx("span", { fg: "gray", children: " \u2502 u:user p:project" })] }));
    return (_jsx(ScreenLayout, { title: "claudeup Settings", currentScreen: "settings", statusLine: statusContent, footerHints: "\u2191\u2193:nav \u2502 u:user scope \u2502 p:project scope \u2502 Enter:project", listPanel: settings.values.status !== "success" ? (_jsx("text", { fg: "gray", children: settings.values.status === "loading"
                ? "Loading..."
                : "Error loading settings" })) : (_jsx(ScrollableList, { items: listItems, selectedIndex: settings.selectedIndex, renderItem: renderSettingRow, maxHeight: dimensions.listPanelHeight })), detailPanel: renderDetail() }));
}
export default SettingsScreen;
