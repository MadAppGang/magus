import React, { useEffect, useCallback, useMemo } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import {
	SETTINGS_CATALOG,
	type SettingCategory,
	type SettingDefinition,
} from "../../data/settings-catalog.js";
import {
	readAllSettingsBothScopes,
	writeSettingValue,
	type ScopedSettingValues,
} from "../../services/settings-manager.js";

interface SettingsListItem {
	id: string;
	type: "category" | "setting";
	label: string;
	category?: SettingCategory;
	setting?: SettingDefinition;
	scopedValues?: ScopedSettingValues;
	effectiveValue?: string;
	isDefault: boolean;
}

const CATEGORY_LABELS: Record<SettingCategory, string> = {
	recommended: "Recommended",
	agents: "Agents & Teams",
	models: "Models & Thinking",
	workflow: "Workflow",
	terminal: "Terminal & UI",
	performance: "Performance",
	advanced: "Advanced",
};

const CATEGORY_ORDER: SettingCategory[] = [
	"recommended",
	"agents",
	"models",
	"workflow",
	"terminal",
	"performance",
	"advanced",
];

/** Get the effective value (project overrides user) */
function getEffectiveValue(scoped: ScopedSettingValues): string | undefined {
	return scoped.project !== undefined ? scoped.project : scoped.user;
}

function buildListItems(
	values: Map<string, ScopedSettingValues>,
): SettingsListItem[] {
	const items: SettingsListItem[] = [];

	for (const category of CATEGORY_ORDER) {
		items.push({
			id: `cat:${category}`,
			type: "category",
			label: CATEGORY_LABELS[category],
			category,
			isDefault: true,
		});

		const categorySettings = SETTINGS_CATALOG.filter(
			(s) => s.category === category,
		);
		for (const setting of categorySettings) {
			const scoped = values.get(setting.id) || {
				user: undefined,
				project: undefined,
			};
			const effective = getEffectiveValue(scoped);
			items.push({
				id: `setting:${setting.id}`,
				type: "setting",
				label: setting.name,
				category,
				setting,
				scopedValues: scoped,
				effectiveValue: effective,
				isDefault: effective === undefined || effective === "",
			});
		}
	}

	return items;
}

function formatValue(
	setting: SettingDefinition,
	value: string | undefined,
): string {
	if (value === undefined || value === "") {
		if (setting.defaultValue !== undefined) {
			return setting.type === "boolean"
				? setting.defaultValue === "true"
					? "on"
					: "off"
				: setting.defaultValue || "default";
		}
		return "—";
	}

	if (setting.type === "boolean") {
		return value === "true" || value === "1" ? "on" : "off";
	}

	if (setting.type === "select" && setting.options) {
		const opt = setting.options.find((o) => o.value === value);
		return opt ? opt.label : value;
	}

	if (value.length > 20) {
		return value.slice(0, 20) + "...";
	}
	return value;
}

export function SettingsScreen() {
	const { state, dispatch } = useApp();
	const { settings } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	// Fetch data from both scopes
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

	// Build flat list items
	const listItems = useMemo((): SettingsListItem[] => {
		if (settings.values.status !== "success") return [];
		return buildListItems(settings.values.data);
	}, [settings.values]);

	const selectableItems = useMemo(
		() =>
			listItems.filter(
				(item) => item.type === "category" || item.type === "setting",
			),
		[listItems],
	);

	// Change a setting in a specific scope
	const handleScopeChange = async (scope: "user" | "project") => {
		const item = selectableItems[settings.selectedIndex];
		if (!item || item.type !== "setting" || !item.setting) return;

		const setting = item.setting;
		const currentValue =
			scope === "user" ? item.scopedValues?.user : item.scopedValues?.project;

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
			// Find current value index for pre-selection
			const currentIndex = setting.options.findIndex(
				(o) => o.value === currentValue,
			);
			// Add "clear" option to remove the setting
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

	// Keyboard handling
	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "up" || event.name === "k") {
			const newIndex = Math.max(0, settings.selectedIndex - 1);
			dispatch({ type: "SETTINGS_SELECT", index: newIndex });
		} else if (event.name === "down" || event.name === "j") {
			const newIndex = Math.min(
				Math.max(0, selectableItems.length - 1),
				settings.selectedIndex + 1,
			);
			dispatch({ type: "SETTINGS_SELECT", index: newIndex });
		} else if (event.name === "u") {
			handleScopeChange("user");
		} else if (event.name === "p") {
			handleScopeChange("project");
		} else if (event.name === "enter") {
			// Enter defaults to project scope
			handleScopeChange("project");
		}
	});

	const selectedItem = selectableItems[settings.selectedIndex];

	const renderListItem = (
		item: SettingsListItem,
		_idx: number,
		isSelected: boolean,
	) => {
		if (item.type === "category") {
			const cat = item.category!;
			const catBg =
				cat === "recommended" ? "#2e7d32"
				: cat === "agents" ? "#00838f"
				: cat === "models" ? "#4527a0"
				: cat === "workflow" ? "#1565c0"
				: cat === "terminal" ? "#4e342e"
				: cat === "performance" ? "#6a1b9a"
				: "#e65100";
			const star = cat === "recommended" ? "★ " : "";

			if (isSelected) {
				return (
					<text bg="magenta" fg="white">
						<strong> {star}{CATEGORY_LABELS[cat]} </strong>
					</text>
				);
			}
			return (
				<text bg={catBg} fg="white">
					<strong> {star}{CATEGORY_LABELS[cat]} </strong>
				</text>
			);
		}

		if (item.type === "setting" && item.setting) {
			const setting = item.setting;
			const indicator = item.isDefault ? "○" : "●";
			const indicatorColor = item.isDefault ? "gray" : "cyan";
			const displayValue = formatValue(setting, item.effectiveValue);
			const valueColor = item.isDefault ? "gray" : "green";

			if (isSelected) {
				return (
					<text bg="magenta" fg="white">
						{" "}
						{indicator} {setting.name.padEnd(28)}
						{displayValue}{" "}
					</text>
				);
			}

			return (
				<text>
					<span fg={indicatorColor}> {indicator} </span>
					<span>{setting.name.padEnd(28)}</span>
					<span fg={valueColor}>{displayValue}</span>
				</text>
			);
		}

		return <text fg="gray">{item.label}</text>;
	};

	const renderDetail = () => {
		if (settings.values.status === "loading") {
			return <text fg="gray">Loading settings...</text>;
		}

		if (settings.values.status === "error") {
			return <text fg="red">Failed to load settings</text>;
		}

		if (!selectedItem) {
			return <text fg="gray">Select a setting to see details</text>;
		}

		if (selectedItem.type === "category") {
			const cat = selectedItem.category!;
			const catColor =
				cat === "recommended"
					? "green"
					: cat === "agents" || cat === "models"
						? "cyan"
						: cat === "workflow" || cat === "terminal"
							? "blue"
							: cat === "performance"
								? "magentaBright"
								: "yellow";
			const descriptions: Record<SettingCategory, string> = {
				recommended: "Most impactful settings every user should know.",
				agents: "Agent teams, task lists, and subagent configuration.",
				models: "Model selection, extended thinking, and effort.",
				workflow: "Git, plans, permissions, output style, and languages.",
				terminal: "Shell, spinners, progress bars, voice, and UI behavior.",
				performance: "Compaction, token limits, timeouts, and caching.",
				advanced: "Telemetry, updates, debugging, and internal controls.",
			};
			return (
				<box flexDirection="column">
					<text fg={catColor}>
						<strong>{CATEGORY_LABELS[cat]}</strong>
					</text>
					<box marginTop={1}>
						<text fg="gray">{descriptions[cat]}</text>
					</box>
				</box>
			);
		}

		if (selectedItem.type === "setting" && selectedItem.setting) {
			const setting = selectedItem.setting;
			const scoped = selectedItem.scopedValues || {
				user: undefined,
				project: undefined,
			};
			const storageDesc =
				setting.storage.type === "env"
					? `env: ${setting.storage.key}`
					: `settings.json: ${setting.storage.key}`;

			const userValue = formatValue(setting, scoped.user);
			const projectValue = formatValue(setting, scoped.project);
			const userIsSet = scoped.user !== undefined && scoped.user !== "";
			const projectIsSet =
				scoped.project !== undefined && scoped.project !== "";

			const actionLabel =
				setting.type === "boolean"
					? "toggle"
					: setting.type === "select"
						? "choose"
						: "edit";

			return (
				<box flexDirection="column">
					<text fg="cyan">
						<strong>{setting.name}</strong>
					</text>
					<box marginTop={1}>
						<text fg="white">{setting.description}</text>
					</box>

					{/* Storage info */}
					<box marginTop={1}>
						<text>
							<span fg="gray">Stored </span>
							<span fg="#5c9aff">{storageDesc}</span>
						</text>
					</box>
					{setting.defaultValue !== undefined && (
						<box>
							<text>
								<span fg="gray">Default </span>
								<span>{setting.defaultValue}</span>
							</text>
						</box>
					)}

					{/* Scopes — same pattern as Plugins */}
					<box flexDirection="column" marginTop={1}>
						<text>────────────────────────</text>
						<text>
							<strong>Scopes:</strong>
						</text>
						<box marginTop={1} flexDirection="column">
							<text>
								<span bg="cyan" fg="black">
									{" "}
									u{" "}
								</span>
								<span fg={userIsSet ? "cyan" : "gray"}>
									{userIsSet ? " ● " : " ○ "}
								</span>
								<span fg="cyan">User</span>
								<span> global</span>
								<span fg={userIsSet ? "cyan" : "gray"}> {userValue}</span>
							</text>
							<text>
								<span bg="green" fg="black">
									{" "}
									p{" "}
								</span>
								<span fg={projectIsSet ? "green" : "gray"}>
									{projectIsSet ? " ● " : " ○ "}
								</span>
								<span fg="green">Project</span>
								<span> team</span>
								<span fg={projectIsSet ? "green" : "gray"}>
									{" "}
									{projectValue}
								</span>
							</text>
						</box>
					</box>

					{/* Action hint */}
					<box marginTop={1}>
						<text fg="gray">Press u/p to {actionLabel} in scope</text>
					</box>
				</box>
			);
		}

		return null;
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
						items={selectableItems}
						selectedIndex={settings.selectedIndex}
						renderItem={renderListItem}
						maxHeight={dimensions.listPanelHeight}
					/>
				)
			}
			detailPanel={renderDetail()}
		/>
	);
}

export default SettingsScreen;
