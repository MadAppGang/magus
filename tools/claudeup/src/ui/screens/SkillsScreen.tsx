import React, { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { EmptyFilterState } from "../components/EmptyFilterState.js";
import { scopeIndicatorText } from "../components/ScopeIndicator.js";
import {
	fetchAvailableSkills,
	fetchSkillFrontmatter,
	installSkill,
	uninstallSkill,
} from "../../services/skills-manager.js";
import { searchSkills } from "../../services/skillsmp-client.js";
import { DEFAULT_SKILL_REPOS, RECOMMENDED_SKILLS } from "../../data/skill-repos.js";
import type { SkillInfo, SkillSource } from "../../types/index.js";

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

	// Remote search: query Firebase API when user types (debounced, cached)
	const [searchResults, setSearchResults] = useState<SkillInfo[]>([]);
	const [isSearchLoading, setIsSearchLoading] = useState(false);
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const searchCacheRef = useRef<Map<string, SkillInfo[]>>(new Map());

	useEffect(() => {
		const query = skillsState.searchQuery.trim();
		if (query.length < 2) {
			setSearchResults([]);
			setIsSearchLoading(false);
			return;
		}

		// Check cache first
		const cached = searchCacheRef.current.get(query);
		if (cached) {
			setSearchResults(cached);
			setIsSearchLoading(false);
			return;
		}

		setIsSearchLoading(true);

		if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		searchTimerRef.current = setTimeout(async () => {
			try {
				const results = await searchSkills(query, { limit: 30 });
				const mapped: SkillInfo[] = results.map((r) => {
					const source: SkillSource = {
						label: r.repo || "unknown",
						repo: r.repo || "unknown",
						skillsPath: "",
					};
					return {
						id: `remote:${r.repo}/${r.skillPath}`,
						name: r.name,
						description: r.description || "",
						source,
						repoPath: r.skillPath ? `${r.skillPath}/SKILL.md` : "SKILL.md",
						gitBlobSha: "",
						frontmatter: null,
						installed: false,
						installedScope: null,
						hasUpdate: false,
						stars: r.stars,
					};
				});
				searchCacheRef.current.set(query, mapped);
				setSearchResults(mapped);
			} catch {
				setSearchResults([]);
			}
			setIsSearchLoading(false);
		}, 400);

		return () => {
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		};
	}, [skillsState.searchQuery]);

	// Static recommended skills — always available, no API needed
	const staticRecommended = useMemo((): SkillInfo[] => {
		return RECOMMENDED_SKILLS.map((r) => ({
			id: `rec:${r.repo}/${r.skillPath}`,
			name: r.name,
			description: r.description,
			source: { label: r.repo, repo: r.repo, skillsPath: "" },
			repoPath: `${r.skillPath}/SKILL.md`,
			gitBlobSha: "",
			frontmatter: null,
			installed: false,
			installedScope: null,
			hasUpdate: false,
			isRecommended: true,
			stars: undefined,
		}));
	}, []);

	// Merge static recommended with fetched data (to get install status + stars)
	const mergedRecommended = useMemo((): SkillInfo[] => {
		if (skillsState.skills.status !== "success") return staticRecommended;
		const fetched = skillsState.skills.data.filter((s) => s.isRecommended);
		// Merge: keep fetched data (has stars + install status), fall back to static
		return staticRecommended.map((staticSkill) => {
			const match = fetched.find(
				(f) => f.source.repo === staticSkill.source.repo && f.name === staticSkill.name,
			);
			return match || staticSkill;
		});
	}, [staticRecommended, skillsState.skills]);

	// Build list: recommended always shown, then search results or popular
	const allItems = useMemo((): SkillListItem[] => {
		const query = skillsState.searchQuery.toLowerCase();
		const items: SkillListItem[] = [];

		// ── RECOMMENDED: always shown, filtered when searching ──
		const filteredRec = query
			? mergedRecommended.filter(
					(s) =>
						s.name.toLowerCase().includes(query) ||
						(s.description || "").toLowerCase().includes(query),
				)
			: mergedRecommended;

		items.push({
			id: "cat:recommended",
			type: "category",
			label: "Recommended",
			categoryKey: "recommended",
		});
		for (const skill of filteredRec) {
			items.push({
				id: `skill:${skill.id}`,
				type: "skill",
				label: skill.name,
				skill,
			});
		}

		// ── SEARCH MODE ──
		if (query.length >= 2) {
			// Loading and no-results handled in listPanel, not as list items

			if (!isSearchLoading && searchResults.length > 0) {
				// Dedup against recommended
				const recNames = new Set(mergedRecommended.map((s) => s.name));
				const deduped = searchResults.filter((s) => !recNames.has(s.name));
				if (deduped.length > 0) {
					items.push({
						id: "cat:search",
						type: "category",
						label: `Search (${deduped.length})`,
						categoryKey: "popular",
					});
					for (const skill of deduped) {
						items.push({
							id: `skill:${skill.id}`,
							type: "skill",
							label: skill.name,
							skill,
						});
					}
				}
			}
			// No-results message handled in listPanel below, not as a list item
			return items;
		}

		// ── POPULAR (default, no search query) ──
		// Loading state handled in listPanel, not as category header

		if (skillsState.skills.status === "success") {
			const popularSkills = skillsState.skills.data
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
		}

		return items;
	}, [skillsState.skills, skillsState.searchQuery, searchResults, isSearchLoading, mergedRecommended]);

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
			// Refetch to pick up install status for all skills including recommended
			await fetchData();
			await modal.message(
				"Installed",
				`${selectedSkill.name} installed to ${scope === "user" ? "~/.claude/skills/" : ".claude/skills/"}`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to install: ${error}`, "error");
		}
	}, [selectedSkill, state.projectPath, dispatch, modal, fetchData]);

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
			// Refetch to pick up uninstall status
			await fetchData();
			await modal.message("Uninstalled", `${selectedSkill.name} removed.`, "success");
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to uninstall: ${error}`, "error");
		}
	}, [selectedSkill, state.projectPath, dispatch, modal, fetchData]);

	// Keyboard handling — same pattern as PluginsScreen
	useKeyboard((event) => {
		if (state.modal) return;

		const hasQuery = skillsState.searchQuery.length > 0;

		// Escape: clear search
		if (event.name === "escape") {
			if (hasQuery || isSearchActive) {
				dispatch({ type: "SKILLS_SET_SEARCH", query: "" });
				dispatch({ type: "SET_SEARCHING", isSearching: false });
				dispatch({ type: "SKILLS_SELECT", index: 0 });
			}
			return;
		}

		// Backspace: remove last char
		if (event.name === "backspace" || event.name === "delete") {
			if (hasQuery) {
				const newQuery = skillsState.searchQuery.slice(0, -1);
				dispatch({ type: "SKILLS_SET_SEARCH", query: newQuery });
				dispatch({ type: "SKILLS_SELECT", index: 0 });
				if (!newQuery) dispatch({ type: "SET_SEARCHING", isSearching: false });
			}
			return;
		}

		// Navigation — always works; exits search mode on navigate
		if (event.name === "up" || event.name === "k") {
			if (isSearchActive) dispatch({ type: "SET_SEARCHING", isSearching: false });
			const newIndex = Math.max(0, skillsState.selectedIndex - 1);
			dispatch({ type: "SKILLS_SELECT", index: newIndex });
			return;
		}
		if (event.name === "down" || event.name === "j") {
			if (isSearchActive) dispatch({ type: "SET_SEARCHING", isSearching: false });
			const newIndex = Math.min(
				Math.max(0, selectableItems.length - 1),
				skillsState.selectedIndex + 1,
			);
			dispatch({ type: "SKILLS_SELECT", index: newIndex });
			return;
		}

		// Enter — install (always works)
		if (event.name === "return" || event.name === "enter") {
			if (isSearchActive) {
				dispatch({ type: "SET_SEARCHING", isSearching: false });
				return;
			}
			if (selectedSkill && !selectedSkill.installed) {
				handleInstall("project");
			}
			return;
		}

		// When actively typing in search, letters go to the query
		if (isSearchActive) {
			if (event.name === "k" || event.name === "j") {
				const delta = event.name === "k" ? -1 : 1;
				const newIndex = Math.max(0, Math.min(selectableItems.length - 1, skillsState.selectedIndex + delta));
				dispatch({ type: "SKILLS_SELECT", index: newIndex });
				return;
			}
			if (event.name && event.name.length === 1 && !event.ctrl && !event.meta && !/[0-9]/.test(event.name)) {
				dispatch({ type: "SKILLS_SET_SEARCH", query: skillsState.searchQuery + event.name });
				dispatch({ type: "SKILLS_SELECT", index: 0 });
			}
			return;
		}

		// Action shortcuts (work when not actively typing, even with filter visible)
		if (event.name === "u" && selectedSkill) {
			if (selectedSkill.installed && selectedSkill.installedScope === "user") handleUninstall();
			else handleInstall("user");
		} else if (event.name === "p" && selectedSkill) {
			if (selectedSkill.installed && selectedSkill.installedScope === "project") handleUninstall();
			else handleInstall("project");
		} else if (event.name === "d" && selectedSkill?.installed) {
			handleUninstall();
		} else if (event.name === "r") {
			fetchData();
		}
		// "/" to enter search mode
		else if (event.name === "/") {
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
			const starsStr = formatStars(skill.stars);
			const hasUser = skill.installedScope === "user";
			const hasProject = skill.installedScope === "project";
			const nameColor = skill.installed ? "white" : "gray";

			if (isSelected) {
				return (
					<text bg="magenta" fg="white">
						{" "}
						<span>{hasUser ? "■" : "□"}</span>
						<span>{hasProject ? "■" : "□"}</span>
						{" "}{skill.name}{skill.hasUpdate ? " ⬆" : ""}{starsStr ? `  ${starsStr}` : ""}{" "}
					</text>
				);
			}

			return (
				<text>
					<span> </span>
					<span fg={hasUser ? "cyan" : "#333333"}>■</span>
					<span fg={hasProject ? "green" : "#333333"}>■</span>
					<span> </span>
					<span fg={nameColor}>{skill.name}</span>
					{skill.hasUpdate && <span fg="yellow"> ⬆</span>}
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
			const isNoResults = selectedItem.categoryKey === "no-results";

			if (isNoResults) {
				return (
					<box flexDirection="column">
						<text fg="yellow">
							<strong>No skills found</strong>
						</text>
						<box marginTop={1}>
							<text fg="gray">
								Nothing matched "{skillsState.searchQuery}".
							</text>
						</box>
						<box marginTop={1}>
							<text fg="gray">
								Try a different search term, or if you think this is a mistake, create an issue at:
							</text>
						</box>
						<box marginTop={1}>
							<text fg="#5c9aff">github.com/MadAppGang/magus/issues</text>
						</box>
						<box marginTop={2}>
							<text fg="gray">Press Esc to clear the search.</text>
						</box>
					</box>
				);
			}

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
	const query = skillsState.searchQuery.trim();

	const statusContent = (
		<text>
			<span fg="gray">Skills: </span>
			<span fg="cyan">{installedCount} installed</span>
			{query.length >= 2 && isSearchLoading && (
				<span fg="yellow"> │ searching...</span>
			)}
			{query.length >= 2 && !isSearchLoading && searchResults.length > 0 && (
				<span fg="green"> │ {searchResults.length} found</span>
			)}
			{!query && (
				<span fg="gray"> │ 89K+ searchable</span>
			)}
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
			footerHints={isSearchActive
				? "type to filter │ Enter:done │ Esc:clear"
				: "u:user │ p:project │ d:uninstall │ /:search"
			}
			listPanel={
				<box flexDirection="column">
					<ScrollableList
						items={selectableItems}
						selectedIndex={skillsState.selectedIndex}
						renderItem={renderListItem}
						maxHeight={dimensions.listPanelHeight}
					/>
					{!query && skillsState.skills.status === "loading" && (
						<box marginTop={2} paddingLeft={2}>
							<text fg="yellow">Loading popular skills...</text>
						</box>
					)}
					{query.length >= 2 && isSearchLoading && (
						<box marginTop={2} paddingLeft={2}>
							<text fg="yellow">Searching for "{skillsState.searchQuery}"...</text>
						</box>
					)}
					{query.length >= 2 && !isSearchLoading && searchResults.length === 0 && (
						<EmptyFilterState query={skillsState.searchQuery} entityName="skills" />
					)}
				</box>
			}
			detailPanel={renderDetail()}
		/>
	);
}

export default SkillsScreen;
