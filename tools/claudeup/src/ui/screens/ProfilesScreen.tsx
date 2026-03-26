import React, { useEffect, useCallback } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import {
	listProfiles,
	applyProfile,
	renameProfile,
	deleteProfile,
	exportProfileToJson,
	importProfileFromJson,
} from "../../services/profiles.js";
import {
	readSettings,
	writeSettings,
} from "../../services/claude-settings.js";
import {
	writeClipboard,
	readClipboard,
	ClipboardUnavailableError,
} from "../../utils/clipboard.js";
import {
	PREDEFINED_PROFILES,
	type PredefinedProfile,
} from "../../data/predefined-profiles.js";
import {
	buildProfileListItems,
	renderProfileRow,
	renderProfileDetail,
	type ProfileListItem,
} from "../renderers/profileRenderers.js";

export function ProfilesScreen() {
	const { state, dispatch } = useApp();
	const { profiles: profilesState } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	const fetchData = useCallback(async () => {
		dispatch({ type: "PROFILES_DATA_LOADING" });
		try {
			const entries = await listProfiles(state.projectPath);
			dispatch({ type: "PROFILES_DATA_SUCCESS", profiles: entries });
		} catch (error) {
			dispatch({
				type: "PROFILES_DATA_ERROR",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}, [dispatch, state.projectPath]);

	useEffect(() => {
		fetchData();
	}, [fetchData, state.dataRefreshVersion]);

	const profileList =
		profilesState.profiles.status === "success"
			? profilesState.profiles.data
			: [];

	const allItems = buildProfileListItems(profileList, PREDEFINED_PROFILES);
	const selectedItem: ProfileListItem | undefined =
		allItems[profilesState.selectedIndex];

	const isNavigable = (item: ProfileListItem) => item.kind !== "header";

	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "up" || event.name === "k") {
			let newIndex = profilesState.selectedIndex - 1;
			while (newIndex > 0 && !isNavigable(allItems[newIndex]!)) {
				newIndex--;
			}
			if (newIndex >= 0 && isNavigable(allItems[newIndex]!)) {
				dispatch({ type: "PROFILES_SELECT", index: newIndex });
			}
		} else if (event.name === "down" || event.name === "j") {
			let newIndex = profilesState.selectedIndex + 1;
			while (
				newIndex < allItems.length - 1 &&
				!isNavigable(allItems[newIndex]!)
			) {
				newIndex++;
			}
			if (newIndex < allItems.length && isNavigable(allItems[newIndex]!)) {
				dispatch({ type: "PROFILES_SELECT", index: newIndex });
			}
		} else if (event.name === "enter" || event.name === "a") {
			if (selectedItem?.kind === "predefined") {
				void handleApplyPredefined(selectedItem.profile);
			} else if (selectedItem?.kind === "saved") {
				void handleApply();
			}
		} else if (event.name === "r") {
			if (selectedItem?.kind === "saved") void handleRename();
		} else if (event.name === "d") {
			if (selectedItem?.kind === "saved") void handleDelete();
		} else if (event.name === "c") {
			if (selectedItem?.kind === "saved") void handleCopy();
		} else if (event.name === "i") {
			void handleImport();
		}
	});

	// ─── Actions ──────────────────────────────────────────────────────────────

	const handleApplyPredefined = async (profile: PredefinedProfile) => {
		const allPlugins = [
			...profile.magusPlugins.map((p) => `${p}@magus`),
			...profile.anthropicPlugins.map(
				(p) => `${p}@claude-plugins-official`,
			),
		];
		const settingsCount = Object.keys(profile.settings).length;

		const confirmed = await modal.confirm(
			`Apply ${profile.name}?`,
			`This will add ${allPlugins.length} plugins, ${profile.skills.length} skills, and update ${settingsCount} settings.\n\nSettings are merged additively — existing values are kept.`,
		);
		if (!confirmed) return;

		modal.loading(`Applying "${profile.name}"...`);
		try {
			const settings = await readSettings(state.projectPath);
			settings.enabledPlugins = settings.enabledPlugins ?? {};
			for (const plugin of allPlugins) {
				if (!settings.enabledPlugins[plugin]) {
					settings.enabledPlugins[plugin] = true;
				}
			}
			for (const [key, value] of Object.entries(profile.settings)) {
				if (key === "env") {
					const envMap = value as Record<string, string>;
					const existing = settings as Record<string, unknown>;
					const existingEnv =
						(existing["env"] as Record<string, string> | undefined) ?? {};
					for (const [envKey, envVal] of Object.entries(envMap)) {
						if (!existingEnv[envKey]) {
							existingEnv[envKey] = envVal;
						}
					}
					(settings as Record<string, unknown>)["env"] = existingEnv;
				} else {
					const settingsMap = settings as Record<string, unknown>;
					if (settingsMap[key] === undefined) {
						settingsMap[key] = value;
					}
				}
			}
			await writeSettings(settings, state.projectPath);
			modal.hideModal();
			dispatch({ type: "DATA_REFRESH_COMPLETE" });
			await modal.message(
				"Applied",
				`Profile "${profile.name}" merged into project settings.`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to apply profile: ${error}`, "error");
		}
	};

	const handleApply = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		const scopeChoice = await modal.select(
			"Apply Profile",
			`Apply "${selectedProfile.name}" to which scope?`,
			[
				{ label: "User — ~/.claude/settings.json (global)", value: "user" },
				{
					label: "Project — .claude/settings.json (this project)",
					value: "project",
				},
			],
		);
		if (scopeChoice === null) return;

		const targetScope = scopeChoice as "user" | "project";
		const scopeLabel =
			targetScope === "user"
				? "~/.claude/settings.json"
				: ".claude/settings.json";

		const pluginCount = Object.keys(selectedProfile.plugins).length;
		const emptyWarning =
			pluginCount === 0
				? "\n\nWARNING: This profile has no plugins — applying will disable all plugins."
				: "";

		const confirmed = await modal.confirm(
			"Confirm Apply",
			`This will REPLACE all enabledPlugins in ${scopeLabel}.${emptyWarning}\n\nContinue?`,
		);
		if (!confirmed) return;

		modal.loading(`Applying "${selectedProfile.name}"...`);
		try {
			await applyProfile(
				selectedProfile.id,
				selectedProfile.scope,
				targetScope,
				state.projectPath,
			);
			modal.hideModal();
			dispatch({ type: "DATA_REFRESH_COMPLETE" });
			await modal.message(
				"Applied",
				`Profile "${selectedProfile.name}" applied to ${scopeLabel}.`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to apply profile: ${error}`, "error");
		}
	};

	const handleRename = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		const newName = await modal.input(
			"Rename Profile",
			"New name:",
			selectedProfile.name,
		);
		if (newName === null || !newName.trim()) return;

		modal.loading("Renaming...");
		try {
			await renameProfile(
				selectedProfile.id,
				newName.trim(),
				selectedProfile.scope,
				state.projectPath,
			);
			modal.hideModal();
			await fetchData();
			await modal.message("Renamed", `Profile renamed to "${newName.trim()}".`, "success");
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to rename: ${error}`, "error");
		}
	};

	const handleDelete = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		const confirmed = await modal.confirm(
			`Delete "${selectedProfile.name}"?`,
			"This will permanently remove the profile.",
		);
		if (!confirmed) return;

		modal.loading("Deleting...");
		try {
			await deleteProfile(
				selectedProfile.id,
				selectedProfile.scope,
				state.projectPath,
			);
			modal.hideModal();
			const newIndex = Math.max(
				0,
				Math.min(profilesState.selectedIndex, allItems.length - 2),
			);
			dispatch({ type: "PROFILES_SELECT", index: newIndex });
			await fetchData();
			await modal.message("Deleted", "Profile deleted.", "success");
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to delete: ${error}`, "error");
		}
	};

	const handleCopy = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		modal.loading("Exporting...");
		try {
			const json = await exportProfileToJson(
				selectedProfile.id,
				selectedProfile.scope,
				state.projectPath,
			);
			modal.hideModal();
			try {
				await writeClipboard(json);
				await modal.message(
					"Copied",
					`Profile JSON copied to clipboard.\nShare it with teammates to import.`,
					"success",
				);
			} catch (err) {
				if (err instanceof ClipboardUnavailableError) {
					await modal.message("Profile JSON (copy manually)", json, "info");
				} else {
					throw err;
				}
			}
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to export: ${error}`, "error");
		}
	};

	const handleImport = async () => {
		let json: string | null = null;

		try {
			json = await readClipboard();
		} catch (err) {
			if (err instanceof ClipboardUnavailableError) {
				json = await modal.input("Import Profile", "Paste profile JSON:");
			} else {
				await modal.message("Error", `Clipboard error: ${err}`, "error");
				return;
			}
		}

		if (json === null || !json.trim()) return;

		const scopeChoice = await modal.select(
			"Import Profile",
			"Save imported profile to which scope?",
			[
				{ label: "User — ~/.claude/profiles.json (global)", value: "user" },
				{
					label: "Project — .claude/profiles.json (this project)",
					value: "project",
				},
			],
		);
		if (scopeChoice === null) return;

		const targetScope = scopeChoice as "user" | "project";

		modal.loading("Importing...");
		try {
			const id = await importProfileFromJson(json, targetScope, state.projectPath);
			modal.hideModal();
			await fetchData();
			await modal.message("Imported", `Profile imported successfully (id: ${id}).`, "success");
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to import: ${error}`, "error");
		}
	};

	// ─── Render ───────────────────────────────────────────────────────────────

	const profileCount = profileList.length;
	const userCount = profileList.filter((p) => p.scope === "user").length;
	const projCount = profileList.filter((p) => p.scope === "project").length;

	const statusContent = (
		<text>
			<span fg="blue">{PREDEFINED_PROFILES.length} presets</span>
			<span fg="gray"> + </span>
			<span fg="cyan">{userCount} user</span>
			<span fg="gray"> + </span>
			<span fg="green">{projCount} project</span>
			<span fg="gray"> = </span>
			<span fg="white">{PREDEFINED_PROFILES.length + profileCount} total</span>
		</text>
	);

	const firstNavigableIndex = allItems.findIndex(isNavigable);
	const effectiveIndex =
		profilesState.selectedIndex === 0 && selectedItem?.kind === "header"
			? firstNavigableIndex
			: profilesState.selectedIndex;

	const loadingStatus =
		profilesState.profiles.status === "loading"
			? true
			: false;
	const errorMessage =
		profilesState.profiles.status === "error"
			? profilesState.profiles.error.message
			: undefined;

	return (
		<ScreenLayout
			title="claudeup Plugin Profiles"
			currentScreen="profiles"
			statusLine={statusContent}
			footerHints="↑↓:nav │ Enter/a:apply │ r:rename │ d:delete │ c:copy │ i:import"
			listPanel={
				<ScrollableList
					items={allItems}
					selectedIndex={effectiveIndex}
					renderItem={renderProfileRow}
					maxHeight={dimensions.listPanelHeight}
				/>
			}
			detailPanel={renderProfileDetail(
				allItems[effectiveIndex],
				loadingStatus,
				errorMessage,
			)}
		/>
	);
}

export default ProfilesScreen;
