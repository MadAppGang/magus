import React, { useEffect, useCallback, useMemo } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import {
	fetchAvailableSkills,
	fetchSkillFrontmatter,
	installSkill,
	uninstallSkill,
} from "../../services/skills-manager.js";
import { DEFAULT_SKILL_REPOS } from "../../data/skill-repos.js";
import type { SkillInfo } from "../../types/index.js";

interface SkillListItem {
	id: string;
	type: "category" | "skill";
	label: string;
	skill?: SkillInfo;
	categoryKey?: string;
}

function formatStars(stars?: number): string {
	if (!stars) return "";
	if (stars >= 1000000) return `★ ${(stars / 1000000).toFixed(1)}M`;
	if (stars >= 10000) return `★ ${Math.round(stars / 1000)}K`;
	if (stars >= 1000) return `★ ${(stars / 1000).toFixed(1)}K`;
	return `★ ${stars}`;
}

export function SkillsScreen() {
	const { state, dispatch } = useApp();
	const { skills: skillsState } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	const isSearchActive =
		state.isSearching &&
		state.currentRoute.screen === "skills" &&
		!state.modal;

	// Fetch data
	const fetchData = useCallback(async () => {
		dispatch({ type: "SKILLS_DATA_LOADING" });
		try {
			const skills = await fetchAvailableSkills(
				DEFAULT_SKILL_REPOS,
				state.projectPath,
			);
			dispatch({ type: "SKILLS_DATA_SUCCESS", skills });
		} catch (error) {
			dispatch({
				type: "SKILLS_DATA_ERROR",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}, [dispatch, state.projectPath]);

	useEffect(() => {
		fetchData();
	}, [fetchData, state.dataRefreshVersion]);

	// Build flat list: Recommended first, then Popular (sorted by stars)
	const allItems = useMemo((): SkillListItem[] => {
		if (skillsState.skills.status !== "success") return [];

		const skills = skillsState.skills.data;
		const query = skillsState.searchQuery.toLowerCase();

		const filtered = query
			? skills.filter(
					(s) =>
						s.name.toLowerCase().includes(query) ||
						s.source.repo.toLowerCase().includes(query) ||
						(s.description || "").toLowerCase().includes(query) ||
						s.frontmatter?.description?.toLowerCase().includes(query),
				)
			: skills;

		const items: SkillListItem[] = [];

		// Recommended section
		const recommendedSkills = filtered.filter((s) => s.isRecommended);
		if (recommendedSkills.length > 0) {
			items.push({
				id: "cat:recommended",
				type: "category",
				label: "Recommended",
				categoryKey: "recommended",
			});
			for (const skill of recommendedSkills) {
				items.push({
					id: `skill:${skill.id}`,
					type: "skill",
					label: skill.name,
					skill,
				});
			}
		}

		// Popular section — skills not in recommended, sorted by stars desc
		const popularSkills = filtered
			.filter((s) => !s.isRecommended)
			.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));

		if (popularSkills.length > 0) {
			items.push({
				id: "cat:popular",
				type: "category",
				label: "Popular",
				categoryKey: "popular",
			});
			for (const skill of popularSkills) {
				items.push({
					id: `skill:${skill.id}`,
					type: "skill",
					label: skill.name,
					skill,
				});
			}
		}

		return items;
	}, [skillsState.skills, skillsState.searchQuery]);

	const selectableItems = useMemo(
		() => allItems.filter((item) => item.type === "skill" || item.type === "category"),
		[allItems],
	);

	const selectedItem = selectableItems[skillsState.selectedIndex];
	const selectedSkill = selectedItem?.type === "skill" ? selectedItem.skill : undefined;

	// Lazy-load frontmatter for selected skill
	useEffect(() => {
		if (!selectedSkill || selectedSkill.frontmatter) return;

		fetchSkillFrontmatter(selectedSkill).then((fm) => {
			dispatch({
				type: "SKILLS_UPDATE_ITEM",
				name: selectedSkill.name,
				updates: { frontmatter: fm },
			});
		}).catch(() => {});
	}, [selectedSkill?.id, dispatch]);

	// Install handler
	const handleInstall = useCallback(async (scope: "user" | "project") => {
		if (!selectedSkill) return;

		modal.loading(`Installing ${selectedSkill.name}...`);
		try {
			await installSkill(selectedSkill, scope, state.projectPath);
			modal.hideModal();
			dispatch({
				type: "SKILLS_UPDATE_ITEM",
				name: selectedSkill.name,
				updates: {
					installed: true,
					installedScope: scope,
				},
			});
			await modal.message(
				"Installed",
				`${selectedSkill.name} installed to ${scope === "user" ? "~/.claude/skills/" : ".claude/skills/"}`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to install: ${error}`, "error");
		}
	}, [selectedSkill, state.projectPath, dispatch, modal]);

	// Uninstall handler
	const handleUninstall = useCallback(async () => {
		if (!selectedSkill || !selectedSkill.installed) return;

		const scope = selectedSkill.installedScope;
		if (!scope) return;

		const confirmed = await modal.confirm(
			`Uninstall "${selectedSkill.name}"?`,
			`This will remove it from the ${scope} scope.`,
		);
		if (!confirmed) return;

		modal.loading(`Uninstalling ${selectedSkill.name}...`);
		try {
			await uninstallSkill(selectedSkill.name, scope, state.projectPath);
			modal.hideModal();
			dispatch({
				type: "SKILLS_UPDATE_ITEM",
				name: selectedSkill.name,
				updates: {
					installed: false,
					installedScope: null,
				},
			});
			await modal.message("Uninstalled", `${selectedSkill.name} removed.`, "success");
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to uninstall: ${error}`, "error");
		}
	}, [selectedSkill, state.projectPath, dispatch, modal]);

	// Keyboard handling
	useKeyboard((event) => {
		if (state.modal) return;

		if (event.name === "up" || event.name === "k") {
			if (state.isSearching) return;
			const newIndex = Math.max(0, skillsState.selectedIndex - 1);
			dispatch({ type: "SKILLS_SELECT", index: newIndex });
		} else if (event.name === "down" || event.name === "j") {
			if (state.isSearching) return;
			const newIndex = Math.min(
				Math.max(0, selectableItems.length - 1),
				skillsState.selectedIndex + 1,
			);
			dispatch({ type: "SKILLS_SELECT", index: newIndex });
		} else if (event.name === "u") {
			if (state.isSearching) return;
			if (selectedSkill) {
				if (selectedSkill.installed && selectedSkill.installedScope === "user") {
					handleUninstall();
				} else {
					handleInstall("user");
				}
			}
		} else if (event.name === "p") {
			if (state.isSearching) return;
			if (selectedSkill) {
				if (selectedSkill.installed && selectedSkill.installedScope === "project") {
					handleUninstall();
				} else {
					handleInstall("project");
				}
			}
		} else if (event.name === "return" || event.name === "enter") {
			if (state.isSearching) return;
			if (selectedSkill && !selectedSkill.installed) {
				handleInstall("project");
			}
		} else if (event.name === "d") {
			if (state.isSearching) return;
			if (selectedSkill?.installed) {
				handleUninstall();
			}
		} else if (event.name === "r") {
			if (state.isSearching) return;
			fetchData();
		} else if (event.name === "escape") {
			if (skillsState.searchQuery) {
				dispatch({ type: "SKILLS_SET_SEARCH", query: "" });
				dispatch({ type: "SET_SEARCHING", isSearching: false });
			}
		} else if (event.name === "backspace") {
			if (skillsState.searchQuery) {
				const newQuery = skillsState.searchQuery.slice(0, -1);
				dispatch({ type: "SKILLS_SET_SEARCH", query: newQuery });
				if (!newQuery) {
					dispatch({ type: "SET_SEARCHING", isSearching: false });
				}
			}
		} else if (
			event.name &&
			event.name.length === 1 &&
			!/[0-9]/.test(event.name) &&
			!event.ctrl &&
			!event.meta
		) {
			// Inline search: type to filter
			const newQuery = skillsState.searchQuery + event.name;
			dispatch({ type: "SKILLS_SET_SEARCH", query: newQuery });
			dispatch({ type: "SET_SEARCHING", isSearching: true });
		}
	});

	const renderListItem = (
		item: SkillListItem,
		_idx: number,
		isSelected: boolean,
	) => {
		if (item.type === "category") {
			const isRec = item.categoryKey === "recommended";
			const bgColor = isRec ? "green" : "cyan";
			const star = isRec ? "★ " : "";

			if (isSelected) {
				return (
					<text bg="magenta" fg="white">
						<strong> {star}{item.label} </strong>
					</text>
				);
			}
			return (
				<text bg={bgColor} fg="white">
					<strong> {star}{item.label} </strong>
				</text>
			);
		}

		if (item.type === "skill" && item.skill) {
			const skill = item.skill;
			const indicator = skill.installed ? "●" : "○";
			const indicatorColor = skill.installed ? "cyan" : "gray";
			const scopeTag = skill.installedScope === "user" ? "u" : skill.installedScope === "project" ? "p" : "";
			const starsStr = formatStars(skill.stars);

			if (isSelected) {
				return (
					<text bg="magenta" fg="white">
						{" "}{indicator} {skill.name}{skill.hasUpdate ? " ⬆" : ""}{scopeTag ? ` [${scopeTag}]` : ""}{starsStr ? `  ${starsStr}` : ""}{" "}
					</text>
				);
			}

			return (
				<text>
					<span fg={indicatorColor}> {indicator} </span>
					<span fg="white">{skill.name}</span>
					{skill.hasUpdate && <span fg="yellow"> ⬆</span>}
					{scopeTag && (
						<span fg={scopeTag === "u" ? "cyan" : "green"}> [{scopeTag}]</span>
					)}
					{starsStr && (
						<span fg="yellow">{"  "}{starsStr}</span>
					)}
				</text>
			);
		}

		return <text fg="gray">{item.label}</text>;
	};

	const renderDetail = () => {
		if (skillsState.skills.status === "loading") {
			return <text fg="gray">Loading skills...</text>;
		}

		if (skillsState.skills.status === "error") {
			return (
				<box flexDirection="column">
					<text fg="red">Failed to load skills</text>
					<box marginTop={1}>
						<text fg="gray">{skillsState.skills.error.message}</text>
					</box>
				</box>
			);
		}

		if (!selectedItem) {
			return <text fg="gray">Select a skill to see details</text>;
		}

		if (selectedItem.type === "category") {
			const isRec = selectedItem.categoryKey === "recommended";
			return (
				<box flexDirection="column">
					<text fg={isRec ? "green" : "cyan"}>
						<strong>{isRec ? "★ " : ""}{selectedItem.label}</strong>
					</text>
					<box marginTop={1}>
						<text fg="gray">
							{isRec ? "Curated skills recommended for most projects" : "Popular skills sorted by stars"}
						</text>
					</box>
				</box>
			);
		}

		if (!selectedSkill) return null;

		const fm = selectedSkill.frontmatter;
		const description = fm?.description || selectedSkill.description || "Loading...";
		const scopeColor = selectedSkill.installedScope === "user" ? "cyan" : "green";
		const starsStr = formatStars(selectedSkill.stars);

		return (
			<box flexDirection="column">
				<text fg="cyan">
					<strong>{selectedSkill.name}</strong>
					{starsStr && <span fg="yellow">  {starsStr}</span>}
				</text>

				<box marginTop={1}>
					<text fg="white">
						{description}
					</text>
				</box>

				{fm?.category && (
					<box marginTop={1}>
						<text>
							<span fg="gray">Category  </span>
							<span fg="cyan">{fm.category}</span>
						</text>
					</box>
				)}

				{fm?.author && (
					<box>
						<text>
							<span fg="gray">Author    </span>
							<span>{fm.author}</span>
						</text>
					</box>
				)}

				{fm?.version && (
					<box>
						<text>
							<span fg="gray">Version   </span>
							<span>{fm.version}</span>
						</text>
					</box>
				)}

				{fm?.tags && fm.tags.length > 0 && (
					<box>
						<text>
							<span fg="gray">Tags      </span>
							<span>{fm.tags.join(", ")}</span>
						</text>
					</box>
				)}

				<box marginTop={1} flexDirection="column">
					<text>
						<span fg="gray">Source    </span>
						<span fg="#5c9aff">{selectedSkill.source.repo}</span>
					</text>
					<text>
						<span fg="gray">          </span>
						<span fg="gray">{selectedSkill.repoPath}</span>
					</text>
				</box>

				{selectedSkill.installed && selectedSkill.installedScope && (
					<box marginTop={1} flexDirection="column">
						<text>{"─".repeat(24)}</text>
						<text>
							<span fg="gray">Installed </span>
							<span fg={scopeColor}>
								{selectedSkill.installedScope === "user"
									? "~/.claude/skills/"
									: ".claude/skills/"}
								{selectedSkill.name}/
							</span>
						</text>
					</box>
				)}

				<box marginTop={1} flexDirection="column">
					<text>{"─".repeat(24)}</text>
					<text>
						<strong>Install scope:</strong>
					</text>
					<box marginTop={1} flexDirection="column">
						<text>
							<span bg="cyan" fg="black"> u </span>
							<span fg={selectedSkill.installedScope === "user" ? "cyan" : "gray"}>
								{selectedSkill.installedScope === "user" ? " ● " : " ○ "}
							</span>
							<span fg="cyan">User</span>
							<span fg="gray"> ~/.claude/skills/</span>
						</text>
						<text>
							<span bg="green" fg="black"> p </span>
							<span fg={selectedSkill.installedScope === "project" ? "green" : "gray"}>
								{selectedSkill.installedScope === "project" ? " ● " : " ○ "}
							</span>
							<span fg="green">Project</span>
							<span fg="gray"> .claude/skills/</span>
						</text>
					</box>
				</box>

				{selectedSkill.hasUpdate && (
					<box marginTop={1}>
						<text bg="yellow" fg="black"> UPDATE AVAILABLE </text>
					</box>
				)}

				<box marginTop={1} flexDirection="column">
					{!selectedSkill.installed && (
						<text fg="gray">Press u/p to install in scope</text>
					)}
					{selectedSkill.installed && (
						<text fg="gray">Press d to uninstall</text>
					)}
				</box>
			</box>
		);
	};

	const skills =
		skillsState.skills.status === "success" ? skillsState.skills.data : [];
	const installedCount = skills.filter((s) => s.installed).length;
	const totalCount = skills.length;

	const statusContent = (
		<text>
			<span fg="gray">Skills: </span>
			<span fg="cyan">{installedCount} installed</span>
			<span fg="gray"> │ </span>
			<span fg="white">{totalCount} available</span>
		</text>
	);

	return (
		<ScreenLayout
			title="claudeup Skills"
			currentScreen="skills"
			statusLine={statusContent}
			search={
				skillsState.searchQuery || isSearchActive
					? {
							isActive: isSearchActive,
							query: skillsState.searchQuery,
							placeholder: "type to search",
						}
					: undefined
			}
			footerHints="↑↓:nav │ u:user │ p:project │ d:uninstall │ type to search"
			listPanel={
				skillsState.skills.status !== "success" ? (
					<text fg="gray">
						{skillsState.skills.status === "loading"
							? "Loading skills..."
							: skillsState.skills.status === "error"
								? "Error loading skills"
								: "Press r to load skills"}
					</text>
				) : (
					<ScrollableList
						items={selectableItems}
						selectedIndex={skillsState.selectedIndex}
						renderItem={renderListItem}
						maxHeight={dimensions.listPanelHeight}
					/>
				)
			}
			detailPanel={renderDetail()}
		/>
	);
}

export default SkillsScreen;
