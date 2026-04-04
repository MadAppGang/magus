import React, { useEffect, useCallback, useMemo, useState, useRef } from "react";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";

import { EmptyFilterState } from "../components/EmptyFilterState.js";
import {
  fetchAvailableSkills,
  fetchSkillFrontmatter,
  fetchSkillSetSkills,
  installSkill,
  uninstallSkill,
} from "../../services/skills-manager.js";
import { searchSkills } from "../../services/skillsmp-client.js";
import { DEFAULT_SKILL_REPOS, RECOMMENDED_SKILLS, RECOMMENDED_SKILL_SETS, classifyStarReliability } from "../../data/skill-repos.js";
import type { SkillInfo, SkillSetInfo, SkillSource } from "../../types/index.js";
import { buildSkillBrowserItems } from "../adapters/skillsAdapter.js";
import type { SkillBrowserItem } from "../adapters/skillsAdapter.js";
import { renderSkillRow, renderSkillDetail } from "../renderers/skillRenderers.js";
import { ScrollableList } from "../components/ScrollableList.js";

export function SkillsScreen() {
  const { state, dispatch } = useApp();
  const { skills: skillsState } = state;
  const modal = useModal();
  const dimensions = useDimensions();

  const isSearchActive =
    state.isSearching &&
    state.currentRoute.screen === "skills" &&
    !state.modal;

  // ── Data fetching ─────────────────────────────────────────────────────────

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

  // ── Remote search (debounced, cached) ─────────────────────────────────────

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
            starReliability: classifyStarReliability(r.repo || "unknown", r.stars),
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

  // ── Disk scan for installed skills ────────────────────────────────────────

  const [installedFromDisk, setInstalledFromDisk] = useState<{
    user: Set<string>;
    project: Set<string>;
  }>({ user: new Set(), project: new Set() });

  const scanDisk = useCallback(async () => {
    const user = new Set<string>();
    const project = new Set<string>();
    const userDir = path.join(os.homedir(), ".claude", "skills");
    const projDir = path.join(state.projectPath || process.cwd(), ".claude", "skills");
    for (const [dir, set] of [[userDir, user], [projDir, project]] as const) {
      try {
        if (await fs.pathExists(dir)) {
          const entries = await fs.readdir(dir);
          for (const e of entries) {
            if (await fs.pathExists(path.join(dir, e, "SKILL.md"))) set.add(e);
          }
        }
      } catch { /* ignore */ }
    }
    setInstalledFromDisk({ user, project });
  }, [state.projectPath]);

  useEffect(() => {
    scanDisk();
  }, [scanDisk, state.dataRefreshVersion]);

  // ── Skill Sets state ──────────────────────────────────────────────────────

  const [skillSets, setSkillSets] = useState<SkillSetInfo[]>(() =>
    RECOMMENDED_SKILL_SETS.map((rs) => ({
      id: rs.repo,
      name: rs.name,
      description: rs.description,
      repo: rs.repo,
      icon: rs.icon,
      stars: rs.stars,
      skills: [],
      loaded: false,
      loading: false,
    })),
  );
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  // Re-mark installed status on child skills when disk state changes
  useEffect(() => {
    setSkillSets((prev) =>
      prev.map((set) => {
        if (!set.loaded) return set;
        const updatedSkills = set.skills.map((skill) => {
          const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const isUser = installedFromDisk.user.has(slug) || installedFromDisk.user.has(skill.name);
          const isProj = installedFromDisk.project.has(slug) || installedFromDisk.project.has(skill.name);
          return {
            ...skill,
            installed: isUser || isProj,
            installedScope: isProj ? "project" as const : isUser ? "user" as const : null,
          };
        });
        return { ...set, skills: updatedSkills };
      }),
    );
  }, [installedFromDisk]);

  const handleToggleSet = useCallback(
    async (setId: string) => {
      const isExpanded = expandedSets.has(setId);
      const newExpanded = new Set(expandedSets);
      if (isExpanded) {
        newExpanded.delete(setId);
      } else {
        newExpanded.add(setId);
      }
      setExpandedSets(newExpanded);

      // Fetch skills on first expand
      const set = skillSets.find((s) => s.id === setId);
      if (!isExpanded && set && !set.loaded && !set.loading) {
        setSkillSets((prev) =>
          prev.map((s) => (s.id === setId ? { ...s, loading: true } : s)),
        );
        try {
          const skills = await fetchSkillSetSkills(set.repo, state.projectPath);
          setSkillSets((prev) =>
            prev.map((s) =>
              s.id === setId
                ? { ...s, skills, loaded: true, loading: false, error: undefined }
                : s,
            ),
          );
        } catch (error) {
          setSkillSets((prev) =>
            prev.map((s) =>
              s.id === setId
                ? {
                    ...s,
                    loading: false,
                    error: error instanceof Error ? error.message : String(error),
                  }
                : s,
            ),
          );
        }
      }
    },
    [expandedSets, skillSets, state.projectPath],
  );

  // Status bar message (auto-clears)
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStatus = useCallback((text: string, tone: "success" | "error" = "success") => {
    setStatusMsg({ text, tone });
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatusMsg(null), 3000);
  }, []);

  const handleInstallAllFromSet = useCallback(
    async (setId: string, scope: "user" | "project") => {
      const set = skillSets.find((s) => s.id === setId);
      if (!set || !set.loaded) return;

      const toInstall = set.skills.filter((s) => !s.installed);
      if (toInstall.length === 0) {
        showStatus(`All ${set.name} skills already installed`);
        return;
      }

      showStatus(`Installing ${toInstall.length} skills from ${set.name}...`);
      let installed = 0;
      let failed = 0;
      for (const skill of toInstall) {
        try {
          await installSkill(skill, scope, state.projectPath);
          installed++;
        } catch {
          failed++;
        }
      }
      await scanDisk();
      if (failed > 0) {
        showStatus(`Installed ${installed}/${toInstall.length} (${failed} failed)`, "error");
      } else {
        showStatus(`Installed ${installed} skills from ${set.name} to ${scope}`);
      }
    },
    [skillSets, state.projectPath, scanDisk, showStatus],
  );

  // ── Derived data ──────────────────────────────────────────────────────────

  const staticRecommended = useMemo((): SkillInfo[] => {
    return RECOMMENDED_SKILLS.map((r) => {
      const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const isUser = installedFromDisk.user.has(slug) || installedFromDisk.user.has(r.name);
      const isProj = installedFromDisk.project.has(slug) || installedFromDisk.project.has(r.name);
      return {
        id: `rec:${r.repo}/${r.skillPath}`,
        name: r.name,
        description: r.description,
        source: { label: r.repo, repo: r.repo, skillsPath: "" },
        repoPath: `${r.skillPath}/SKILL.md`,
        gitBlobSha: "",
        frontmatter: null,
        installed: isUser || isProj,
        installedScope: isProj ? "project" : isUser ? "user" : null,
        hasUpdate: false,
        isRecommended: true,
        stars: r.stars,
        starReliability: classifyStarReliability(r.repo, r.stars),
      };
    });
  }, [installedFromDisk]);

  const mergedRecommended = useMemo((): SkillInfo[] => {
    if (skillsState.skills.status !== "success") return staticRecommended;
    const fetched = skillsState.skills.data.filter((s) => s.isRecommended);
    return staticRecommended.map((staticSkill) => {
      const match = fetched.find(
        (f) => f.source.repo === staticSkill.source.repo && f.name === staticSkill.name,
      );
      if (!match) return staticSkill;
      // Merge: prefer fetched data for description/stars, but disk scan is
      // authoritative for installed state (staticSkill reflects current disk)
      return {
        ...staticSkill,
        ...match,
        installed: staticSkill.installed,
        installedScope: staticSkill.installedScope,
        stars: match.stars || staticSkill.stars,
      };
    });
  }, [staticRecommended, skillsState.skills]);

  const installedSkills = useMemo((): SkillInfo[] => {
    const all: SkillInfo[] = [];
    for (const [scope, names] of [
      ["user", installedFromDisk.user],
      ["project", installedFromDisk.project],
    ] as const) {
      for (const name of names) {
        if (all.some((s) => s.name === name)) continue;
        all.push({
          id: `installed:${scope}/${name}`,
          name,
          description: "",
          source: { label: "local", repo: "local", skillsPath: "" },
          repoPath: "",
          gitBlobSha: "",
          frontmatter: null,
          installed: true,
          installedScope: scope,
          hasUpdate: false,
          stars: undefined,
        });
      }
    }
    return all;
  }, [installedFromDisk]);

  const popularSkills = useMemo((): SkillInfo[] => {
    if (skillsState.skills.status !== "success") return [];
    return skillsState.skills.data
      .filter((s) => !s.isRecommended)
      .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  }, [skillsState.skills]);

  // ── List items (built by adapter) ─────────────────────────────────────────

  const allItems = useMemo(
    () =>
      buildSkillBrowserItems({
        recommended: mergedRecommended,
        popular: popularSkills,
        installed: installedSkills,
        searchResults,
        query: skillsState.searchQuery,
        isSearchLoading,
        skillSets,
        expandedSets,
      }),
    [
      mergedRecommended,
      popularSkills,
      installedSkills,
      searchResults,
      skillsState.searchQuery,
      isSearchLoading,
      skillSets,
      expandedSets,
    ],
  );

  // Auto-correct selection if it lands on a category header (e.g. initial load, reset)
  useEffect(() => {
    const item = allItems[skillsState.selectedIndex];
    if (item && item.kind === "category") {
      const firstSelectable = allItems.findIndex((i) => i.kind === "skill" || i.kind === "skillset");
      if (firstSelectable >= 0) dispatch({ type: "SKILLS_SELECT", index: firstSelectable });
    }
  }, [allItems, skillsState.selectedIndex, dispatch]);

  const selectedItem: SkillBrowserItem | undefined = allItems[skillsState.selectedIndex];
  const selectedSkill =
    selectedItem?.kind === "skill" ? selectedItem.skill : undefined;
  const selectedSet =
    selectedItem?.kind === "skillset" ? selectedItem.skillSet : undefined;

  // ── Lazy-load frontmatter for selected skill ───────────────────────────────

  // Check if selected skill belongs to a skill set (lives in local state, not reducer)
  const isSkillSetChild = selectedSkill
    ? skillSets.some((s) => s.loaded && s.skills.some((sk) => sk.id === selectedSkill.id))
    : false;

  useEffect(() => {
    if (!selectedSkill || selectedSkill.frontmatter) return;
    fetchSkillFrontmatter(selectedSkill).then((fm) => {
      if (isSkillSetChild) {
        // Update the local skillSets state
        setSkillSets((prev) =>
          prev.map((set) => ({
            ...set,
            skills: set.skills.map((sk) =>
              sk.id === selectedSkill.id ? { ...sk, frontmatter: fm } : sk,
            ),
          })),
        );
      } else {
        dispatch({
          type: "SKILLS_UPDATE_ITEM",
          name: selectedSkill.name,
          updates: { frontmatter: fm },
        });
      }
    }).catch(() => {});
  }, [selectedSkill?.id, isSkillSetChild, dispatch]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleInstall = useCallback(async (scope: "user" | "project") => {
    if (!selectedSkill) return;
    try {
      await installSkill(selectedSkill, scope, state.projectPath);
      await scanDisk(); // Re-scan disk only — no network re-fetch needed
      showStatus(`Installed ${selectedSkill.name} to ${scope}`);
    } catch (error) {
      showStatus(`Failed: ${error}`, "error");
    }
  }, [selectedSkill, state.projectPath, scanDisk, showStatus]);

  const handleUninstall = useCallback(async () => {
    if (!selectedSkill || !selectedSkill.installed) return;
    const scope = selectedSkill.installedScope;
    if (!scope) return;

    try {
      await uninstallSkill(selectedSkill.name, scope, state.projectPath);
      await scanDisk(); // Re-scan disk only — no network re-fetch needed
      showStatus(`Removed ${selectedSkill.name} from ${scope}`);
    } catch (error) {
      showStatus(`Failed: ${error}`, "error");
    }
  }, [selectedSkill, state.projectPath, scanDisk, showStatus]);

  // ── Keyboard handling ─────────────────────────────────────────────────────

  useKeyboard((event) => {
    if (state.modal) return;

    const hasQuery = skillsState.searchQuery.length > 0;

    if (event.name === "escape") {
      if (hasQuery || isSearchActive) {
        dispatch({ type: "SKILLS_SET_SEARCH", query: "" });
        dispatch({ type: "SET_SEARCHING", isSearching: false });
        dispatch({ type: "SKILLS_SELECT", index: 0 });
      }
      return;
    }

    if (event.name === "backspace" || event.name === "delete") {
      if (hasQuery) {
        const newQuery = skillsState.searchQuery.slice(0, -1);
        dispatch({ type: "SKILLS_SET_SEARCH", query: newQuery });
        dispatch({ type: "SKILLS_SELECT", index: 0 });
        if (!newQuery) dispatch({ type: "SET_SEARCHING", isSearching: false });
      }
      return;
    }

    if (event.name === "up" || event.name === "k") {
      if (isSearchActive) dispatch({ type: "SET_SEARCHING", isSearching: false });
      let newIndex = skillsState.selectedIndex - 1;
      // Skip category headers
      while (newIndex >= 0 && allItems[newIndex]?.kind === "category") newIndex--;
      if (newIndex >= 0) dispatch({ type: "SKILLS_SELECT", index: newIndex });
      return;
    }
    if (event.name === "down" || event.name === "j") {
      if (isSearchActive) dispatch({ type: "SET_SEARCHING", isSearching: false });
      let newIndex = skillsState.selectedIndex + 1;
      // Skip category headers
      while (newIndex < allItems.length && allItems[newIndex]?.kind === "category") newIndex++;
      if (newIndex < allItems.length) dispatch({ type: "SKILLS_SELECT", index: newIndex });
      return;
    }

    if (event.name === "return" || event.name === "enter") {
      if (isSearchActive) {
        dispatch({ type: "SET_SEARCHING", isSearching: false });
        return;
      }
      if (selectedSet) {
        handleToggleSet(selectedSet.id);
        return;
      }
      if (selectedSkill && !selectedSkill.installed) {
        handleInstall("project");
      }
      return;
    }

    // Action keys only when NOT actively typing in search
    if (!isSearchActive) {
      if (event.name === "u") {
        if (selectedSet) {
          handleInstallAllFromSet(selectedSet.id, "user");
          return;
        }
        if (selectedSkill) {
          if (selectedSkill.installed && selectedSkill.installedScope === "user") handleUninstall();
          else handleInstall("user");
          return;
        }
      } else if (event.name === "p") {
        if (selectedSet) {
          handleInstallAllFromSet(selectedSet.id, "project");
          return;
        }
        if (selectedSkill) {
          if (selectedSkill.installed && selectedSkill.installedScope === "project") handleUninstall();
          else handleInstall("project");
          return;
        }
      }
    }

    if (isSearchActive) {
      if (event.name === "k" || event.name === "j") {
        const delta = event.name === "k" ? -1 : 1;
        const newIndex = Math.max(0, Math.min(allItems.length - 1, skillsState.selectedIndex + delta));
        dispatch({ type: "SKILLS_SELECT", index: newIndex });
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta && !/[0-9]/.test(event.name)) {
        dispatch({ type: "SKILLS_SET_SEARCH", query: skillsState.searchQuery + event.name });
        dispatch({ type: "SKILLS_SELECT", index: 0 });
      }
      return;
    }

    if (event.name === "r") {
      fetchData();
    } else if (event.name === "o" && (selectedSkill || selectedSet)) {
      if (selectedSet) {
        const url = `https://github.com/${selectedSet.repo}`;
        import("node:child_process").then(({ execSync: exec }) => {
          try { exec(`open "${url}"`); } catch { /* ignore */ }
        });
      } else if (selectedSkill) {
        const repo = selectedSkill.source.repo;
        const repoPath = selectedSkill.repoPath?.replace("/SKILL.md", "") || "";
        if (repo && repo !== "local") {
          const url = `https://github.com/${repo}/tree/main/${repoPath}`;
          import("node:child_process").then(({ execSync: exec }) => {
            try { exec(`open "${url}"`); } catch { /* ignore */ }
          });
        }
      }
    } else if (event.name === "/") {
      dispatch({ type: "SET_SEARCHING", isSearching: true });
    }
  });

  // ── Status line ───────────────────────────────────────────────────────────

  const skills =
    skillsState.skills.status === "success" ? skillsState.skills.data : [];
  const installedCount = skills.filter((s) => s.installed).length;
  const query = skillsState.searchQuery.trim();

  const statusContent = statusMsg ? (
    <text>
      <span fg={statusMsg.tone === "success" ? "green" : "red"}>{statusMsg.text}</span>
    </text>
  ) : (
    <text>
      <span fg="gray">Skills: </span>
      <span fg="cyan">{installedCount} installed</span>
      {query.length >= 2 && isSearchLoading && (
        <span fg="yellow"> │ searching...</span>
      )}
      {query.length >= 2 && !isSearchLoading && searchResults.length > 0 && (
        <span fg="green"> │ {searchResults.length} found</span>
      )}
      {!query && <span fg="gray"> │ 89K+ searchable</span>}
    </text>
  );

  // ── Render ────────────────────────────────────────────────────────────────

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
      footerHints={
        isSearchActive
          ? "type to filter │ Enter:done │ Esc:clear"
          : "u:user │ p:project │ o:open │ /:search"
      }
      listPanel={
        <box flexDirection="column">
          <ScrollableList
            items={allItems}
            selectedIndex={skillsState.selectedIndex}
            renderItem={renderSkillRow}
            maxHeight={dimensions.listPanelHeight}
            getKey={(item, index) => `${index}:${item.id}`}
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
      detailPanel={renderSkillDetail(selectedItem)}
    />
  );
}

export default SkillsScreen;
