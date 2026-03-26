import React, { useEffect, useCallback, useMemo } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import {
	SETTINGS_CATALOG,
} from "../../data/settings-catalog.js";
import {
	readAllSettingsBothScopes,
	writeSettingValue,
} from "../../services/settings-manager.js";
import {
	buildSettingsBrowserItems,
	type SettingsBrowserItem,
} from "../adapters/settingsAdapter.js";
import { renderSettingRow, renderSettingDetail } from "../renderers/settingsRenderers.js";

export function SettingsScreen() {
	const { state, dispatch } = useApp();
	const { settings } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	const fetchData = useCallback(async () => {
		dispatch({ type: "SETTINGS_DATA_LOADING" });
		try {
			const values = await readAllSettingsBothScopes(
				SETTINGS_CATALOG,
				state.projectPath,
			);
			dispatch({ type: "SETTINGS_DATA_SUCCESS", values });
		} catch (error) {
			dispatch({
				type: "SETTINGS_DATA_ERROR",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}, [dispatch, state.projectPath]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const listItems = useMemo((): SettingsBrowserItem[] => {
		if (settings.values.status !== "success") return [];
		return buildSettingsBrowserItems(settings.values.data);
	}, [settings.values]);

	const handleScopeChange = async (scope: "user" | "project") => {
		const item = listItems[settings.selectedIndex];
		if (!item || item.kind !== "setting") return;

		const { setting, scopedValues } = item;
		const currentValue =
			scope === "user" ? scopedValues.user : scopedValues.project;

		if (setting.type === "boolean") {
			const currentBool =
				currentValue === "true" ||
				currentValue === "1" ||
				(currentValue === undefined && setting.defaultValue === "true");
			const newValue = currentBool ? "false" : "true";
			try {
				await writeSettingValue(setting, newValue, scope, state.projectPath);
				await fetchData();
			} catch (error) {
				await modal.message("Error", `Failed to update: ${error}`, "error");
			}
		} else if (setting.type === "select" && setting.options) {
			const options = setting.options.map((o) => ({
				label: o.label + (currentValue === o.value ? " (current)" : ""),
				value: o.value,
			}));
			const currentIndex = setting.options.findIndex(
				(o) => o.value === currentValue,
			);
			if (currentValue !== undefined) {
				options.push({ label: "Clear (use default)", value: "__clear__" });
			}
			const selected = await modal.select(
				`${setting.name} — ${scope}`,
				setting.description,
				options,
				currentIndex >= 0 ? currentIndex : undefined,
			);
			if (selected === null) return;
			try {
				const val =
					selected === "__clear__" ? undefined : selected || undefined;
				await writeSettingValue(setting, val, scope, state.projectPath);
				await fetchData();
			} catch (error) {
				await modal.message("Error", `Failed to update: ${error}`, "error");
			}
		} else {
			const newValue = await modal.input(
				`${setting.name} — ${scope}`,
				setting.description,
				currentValue || "",
			);
			if (newValue === null) return;
			try {
				await writeSettingValue(
					setting,
					newValue || undefined,
					scope,
					state.projectPath,
				);
				await fetchData();
			} catch (error) {
				await modal.message("Error", `Failed to update: ${error}`, "error");
			}
		}
	};

	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "up" || event.name === "k") {
			const newIndex = Math.max(0, settings.selectedIndex - 1);
			dispatch({ type: "SETTINGS_SELECT", index: newIndex });
		} else if (event.name === "down" || event.name === "j") {
			const newIndex = Math.min(
				Math.max(0, listItems.length - 1),
				settings.selectedIndex + 1,
			);
			dispatch({ type: "SETTINGS_SELECT", index: newIndex });
		} else if (event.name === "u") {
			handleScopeChange("user");
		} else if (event.name === "p") {
			handleScopeChange("project");
		} else if (event.name === "enter") {
			handleScopeChange("project");
		}
	});

	const selectedItem = listItems[settings.selectedIndex];

	const renderDetail = () => {
		if (settings.values.status === "loading") {
			return <text fg="gray">Loading settings...</text>;
		}
		if (settings.values.status === "error") {
			return <text fg="red">Failed to load settings</text>;
		}
		return renderSettingDetail(selectedItem);
	};

	const totalSet =
		settings.values.status === "success"
			? Array.from(settings.values.data.values()).filter(
					(v) => v.user !== undefined || v.project !== undefined,
				).length
			: 0;

	const statusContent = (
		<text>
			<span fg="gray">Settings: </span>
			<span fg="cyan">{totalSet} configured</span>
			<span fg="gray"> │ u:user p:project</span>
		</text>
	);

	return (
		<ScreenLayout
			title="claudeup Settings"
			currentScreen="settings"
			statusLine={statusContent}
			footerHints="↑↓:nav │ u:user scope │ p:project scope │ Enter:project"
			listPanel={
				settings.values.status !== "success" ? (
					<text fg="gray">
						{settings.values.status === "loading"
							? "Loading..."
							: "Error loading settings"}
					</text>
				) : (
					<ScrollableList
						items={listItems}
						selectedIndex={settings.selectedIndex}
						renderItem={renderSettingRow}
						maxHeight={dimensions.listPanelHeight}
					/>
				)
			}
			detailPanel={renderDetail()}
		/>
	);
}

export default SettingsScreen;
