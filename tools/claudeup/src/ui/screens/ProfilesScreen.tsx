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
import type { ProfileEntry } from "../../types/index.js";
import {
	PREDEFINED_PROFILES,
	type PredefinedProfile,
} from "../../data/predefined-profiles.js";

// ─── List item discriminated union ───────────────────────────────────────────

type ListItem =
	| { kind: "predefined"; profile: PredefinedProfile }
	| { kind: "saved"; entry: ProfileEntry };

function buildListItems(profileList: ProfileEntry[]): ListItem[] {
	const predefined: ListItem[] = PREDEFINED_PROFILES.map((p) => ({
		kind: "predefined" as const,
		profile: p,
	}));
	const saved: ListItem[] = profileList.map((e) => ({
		kind: "saved" as const,
		entry: e,
	}));
	return [...predefined, ...saved];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfilesScreen() {
	const { state, dispatch } = useApp();
	const { profiles: profilesState } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	// Fetch data
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

	const allItems = buildListItems(profileList);
	const selectedItem: ListItem | undefined = allItems[profilesState.selectedIndex];

	// Keyboard handling
	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "up" || event.name === "k") {
			const newIndex = Math.max(0, profilesState.selectedIndex - 1);
			dispatch({ type: "PROFILES_SELECT", index: newIndex });
		} else if (event.name === "down" || event.name === "j") {
			const newIndex = Math.min(
				Math.max(0, allItems.length - 1),
				profilesState.selectedIndex + 1,
			);
			dispatch({ type: "PROFILES_SELECT", index: newIndex });
		} else if (event.name === "enter" || event.name === "a") {
			if (selectedItem?.kind === "predefined") {
				void handleApplyPredefined(selectedItem.profile);
			} else {
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

	// ─── Predefined profile apply ─────────────────────────────────────────────

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

			// Merge plugins (additive only)
			settings.enabledPlugins = settings.enabledPlugins ?? {};
			for (const plugin of allPlugins) {
				if (!settings.enabledPlugins[plugin]) {
					settings.enabledPlugins[plugin] = true;
				}
			}

			// Merge top-level settings (additive — only set if not already set)
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
			await modal.message(
				"Error",
				`Failed to apply profile: ${error}`,
				"error",
			);
		}
	};

	// ─── Saved profile actions ────────────────────────────────────────────────

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
			// Trigger PluginsScreen to refetch
			dispatch({ type: "DATA_REFRESH_COMPLETE" });
			await modal.message(
				"Applied",
				`Profile "${selectedProfile.name}" applied to ${scopeLabel}.`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message(
				"Error",
				`Failed to apply profile: ${error}`,
				"error",
			);
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
			await modal.message(
				"Renamed",
				`Profile renamed to "${newName.trim()}".`,
				"success",
			);
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
			// Adjust selection if we deleted the last item
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
					// Fallback: show JSON in modal for manual copy
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

		// Try to read from clipboard first
		try {
			json = await readClipboard();
		} catch (err) {
			if (err instanceof ClipboardUnavailableError) {
				// Fallback: ask user to paste JSON manually
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
			const id = await importProfileFromJson(
				json,
				targetScope,
				state.projectPath,
			);
			modal.hideModal();
			await fetchData();
			await modal.message(
				"Imported",
				`Profile imported successfully (id: ${id}).`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to import: ${error}`, "error");
		}
	};

	// ─── Rendering helpers ────────────────────────────────────────────────────

	const formatDate = (iso: string): string => {
		try {
			const d = new Date(iso);
			return d.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		} catch {
			return iso;
		}
	};

	const renderListItem = (item: ListItem, _idx: number, isSelected: boolean) => {
		if (item.kind === "predefined") {
			const { profile } = item;
			const pluginCount =
				profile.magusPlugins.length + profile.anthropicPlugins.length;
			const skillCount = profile.skills.length;

			if (isSelected) {
				return (
					<text bg="blue" fg="white">
						{" "}
						{profile.icon} {profile.name} — {pluginCount} plugins · {skillCount}{" "}
						skill{skillCount !== 1 ? "s" : ""}{" "}
					</text>
				);
			}

			return (
				<text>
					<span fg="blue">[preset]</span>
					<span> </span>
					<span fg="white">
						{profile.icon} {profile.name}
					</span>
					<span fg="gray">
						{" "}
						— {pluginCount} plugins · {skillCount} skill
						{skillCount !== 1 ? "s" : ""}
					</span>
				</text>
			);
		}

		// Saved profile
		const { entry } = item;
		const pluginCount = Object.keys(entry.plugins).length;
		const dateStr = formatDate(entry.updatedAt);
		const scopeColor = entry.scope === "user" ? "cyan" : "green";
		const scopeLabel = entry.scope === "user" ? "[user]" : "[proj]";

		if (isSelected) {
			return (
				<text bg="magenta" fg="white">
					{" "}
					{scopeLabel} {entry.name} — {pluginCount} plugin
					{pluginCount !== 1 ? "s" : ""} · {dateStr}{" "}
				</text>
			);
		}

		return (
			<text>
				<span fg={scopeColor}>{scopeLabel}</span>
				<span> </span>
				<span fg="white">{entry.name}</span>
				<span fg="gray">
					{" "}
					— {pluginCount} plugin{pluginCount !== 1 ? "s" : ""} · {dateStr}
				</span>
			</text>
		);
	};

	const renderDetail = () => {
		if (profilesState.profiles.status === "loading") {
			return <text fg="gray">Loading profiles...</text>;
		}

		if (profilesState.profiles.status === "error") {
			return (
				<text fg="red">Error: {profilesState.profiles.error.message}</text>
			);
		}

		if (!selectedItem) {
			return <text fg="gray">Select a profile to see details</text>;
		}

		if (selectedItem.kind === "predefined") {
			return renderPredefinedDetail(selectedItem.profile);
		}

		return renderSavedDetail(selectedItem.entry);
	};

	const renderPredefinedDetail = (profile: PredefinedProfile) => {
		const allPlugins = [
			...profile.magusPlugins.map((p) => `${p}@magus`),
			...profile.anthropicPlugins.map((p) => `${p}@claude-plugins-official`),
		];

		return (
			<box flexDirection="column">
				<text fg="blue">
					<strong>
						{profile.icon} {profile.name}
					</strong>
				</text>
				<box marginTop={1}>
					<text fg="gray">{profile.description}</text>
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">
						Magus plugins ({profile.magusPlugins.length}):
					</text>
					{profile.magusPlugins.map((p) => (
						<box key={p}>
							<text fg="cyan"> {p}@magus</text>
						</box>
					))}
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">
						Anthropic plugins ({profile.anthropicPlugins.length}):
					</text>
					{profile.anthropicPlugins.map((p) => (
						<box key={p}>
							<text fg="yellow"> {p}@claude-plugins-official</text>
						</box>
					))}
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">Skills ({profile.skills.length}):</text>
					{profile.skills.map((s) => (
						<box key={s}>
							<text fg="white"> {s}</text>
						</box>
					))}
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">
						Settings ({Object.keys(profile.settings).length}):
					</text>
					{Object.entries(profile.settings)
						.filter(([k]) => k !== "env")
						.map(([k, v]) => (
							<box key={k}>
								<text fg="white">
									{" "}
									{k}: {String(v)}
								</text>
							</box>
						))}
				</box>
				<box marginTop={2} flexDirection="column">
					<box>
						<text bg="blue" fg="white">
							{" "}
							Enter/a{" "}
						</text>
						<text fg="gray">
							{" "}
							Apply (merges {allPlugins.length} plugins into project settings)
						</text>
					</box>
				</box>
			</box>
		);
	};

	const renderSavedDetail = (selectedProfile: ProfileEntry) => {
		const plugins = Object.keys(selectedProfile.plugins);
		const scopeColor = selectedProfile.scope === "user" ? "cyan" : "green";
		const scopeLabel =
			selectedProfile.scope === "user"
				? "User (~/.claude/profiles.json)"
				: "Project (.claude/profiles.json — committed to git)";

		return (
			<box flexDirection="column">
				<text fg="cyan">
					<strong>{selectedProfile.name}</strong>
				</text>
				<box marginTop={1}>
					<text fg="gray">Scope: </text>
					<text fg={scopeColor}>{scopeLabel}</text>
				</box>
				<box marginTop={1}>
					<text fg="gray">
						Created: {formatDate(selectedProfile.createdAt)} · Updated:{" "}
						{formatDate(selectedProfile.updatedAt)}
					</text>
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">
						Plugins ({plugins.length}
						{plugins.length === 0 ? " — applying will disable all plugins" : ""}
						):
					</text>
					{plugins.length === 0 ? (
						<text fg="yellow"> (none)</text>
					) : (
						plugins.map((p) => (
							<box key={p}>
								<text fg="white"> {p}</text>
							</box>
						))
					)}
				</box>
				<box marginTop={2} flexDirection="column">
					<box>
						<text bg="magenta" fg="white">
							{" "}
							Enter/a{" "}
						</text>
						<text fg="gray"> Apply profile</text>
					</box>
					<box marginTop={1}>
						<text bg="#333333" fg="white">
							{" "}
							r{" "}
						</text>
						<text fg="gray"> Rename</text>
					</box>
					<box marginTop={1}>
						<text bg="red" fg="white">
							{" "}
							d{" "}
						</text>
						<text fg="gray"> Delete</text>
					</box>
					<box marginTop={1}>
						<text bg="blue" fg="white">
							{" "}
							c{" "}
						</text>
						<text fg="gray"> Copy JSON to clipboard</text>
					</box>
					<box marginTop={1}>
						<text bg="green" fg="white">
							{" "}
							i{" "}
						</text>
						<text fg="gray"> Import from clipboard</text>
					</box>
				</box>
			</box>
		);
	};

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

	return (
		<ScreenLayout
			title="claudeup Plugin Profiles"
			currentScreen="profiles"
			statusLine={statusContent}
			footerHints="↑↓:nav │ Enter/a:apply │ r:rename │ d:delete │ c:copy │ i:import"
			listPanel={
				<ScrollableList
					items={allItems}
					selectedIndex={profilesState.selectedIndex}
					renderItem={renderListItem}
					maxHeight={dimensions.listPanelHeight}
				/>
			}
			detailPanel={renderDetail()}
		/>
	);
}

export default ProfilesScreen;
