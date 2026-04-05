import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/react/jsx-runtime";
import { useEffect, useCallback, useState, useRef } from "react";
import { exec } from "child_process";
import { promisify } from "util";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { cliTools } from "../../data/cli-tools.js";
import { renderCliToolRow, renderCliToolDetail, } from "../renderers/cliToolRenderers.js";
const execAsync = promisify(exec);
// ─── Version helpers ───────────────────────────────────────────────────────────
// Session-level cache
let cachedToolStatuses = null;
let cacheInitialized = false;
function clearCliToolsCache() {
    cachedToolStatuses = null;
    cacheInitialized = false;
}
function parseVersion(versionOutput) {
    const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
    return match ? match[1] : undefined;
}
function methodFromPath(binPath) {
    if (binPath.includes("/.bun/"))
        return "bun";
    if (binPath.includes("/homebrew/") || binPath.includes("/Cellar/"))
        return "brew";
    if (binPath.includes("/.local/share/claude") || binPath.includes("/.local/bin/claude"))
        return "npm";
    if (binPath.includes("/.nvm/") || binPath.includes("/node_modules/"))
        return "npm";
    if (binPath.includes("/.local/share/pnpm") || binPath.includes("/pnpm/"))
        return "pnpm";
    if (binPath.includes("/.yarn/"))
        return "yarn";
    return null;
}
/** Extract brew formula name from a Cellar symlink target like ../Cellar/gemini-cli/0.35.2/bin/gemini */
function extractBrewFormula(binPath, linkTarget) {
    // Try symlink target first: ../Cellar/{formula}/{version}/...
    const cellarMatch = linkTarget.match(/Cellar\/([^/]+)\//);
    if (cellarMatch)
        return cellarMatch[1];
    // Try binary path: /opt/homebrew/Cellar/{formula}/...
    const pathMatch = binPath.match(/Cellar\/([^/]+)\//);
    if (pathMatch)
        return pathMatch[1];
    return undefined;
}
async function detectInstallMethods(tool) {
    const fallback = tool.packageManager === "pip" ? "pip" : "unknown";
    try {
        // which -a returns all matching binaries across PATH
        const { stdout } = await execAsync(`which -a ${tool.name} 2>/dev/null`, {
            timeout: 3000,
            shell: "/bin/bash",
        });
        const paths = stdout.trim().split("\n").filter((p) => p && !p.includes("aliased"));
        if (paths.length === 0)
            return { primary: fallback, all: [] };
        const methods = [];
        let brewFormula;
        for (const binPath of paths) {
            let method = methodFromPath(binPath);
            let linkTarget = "";
            // Check symlink target
            try {
                const { stdout: lt } = await execAsync(`readlink "${binPath}" 2>/dev/null || true`, { timeout: 2000, shell: "/bin/bash" });
                linkTarget = lt.trim();
                if (!method)
                    method = methodFromPath(linkTarget);
            }
            catch {
                // ignore
            }
            // Detect brew formula name
            if (method === "brew" && !brewFormula) {
                brewFormula = extractBrewFormula(binPath, linkTarget);
            }
            if (method && !methods.includes(method))
                methods.push(method);
        }
        if (methods.length === 0)
            return { primary: fallback, all: [] };
        return { primary: methods[0], all: methods, brewFormula };
    }
    catch {
        return { primary: fallback, all: [] };
    }
}
function getUninstallCommand(tool, method, brewFormula) {
    switch (method) {
        case "bun": return `bun remove -g ${tool.packageName}`;
        case "npm": return `npm uninstall -g ${tool.packageName}`;
        case "pnpm": return `pnpm remove -g ${tool.packageName}`;
        case "yarn": return `yarn global remove ${tool.packageName}`;
        case "brew": return `brew uninstall ${brewFormula || tool.name}`;
        case "pip": return `pip uninstall -y ${tool.packageName}`;
        default: return "";
    }
}
function getUpdateCommand(tool, method, brewFormula) {
    switch (method) {
        case "bun": return `bun install -g ${tool.packageName}`;
        case "npm": return `npm install -g ${tool.packageName}`;
        case "pnpm": return `pnpm install -g ${tool.packageName}`;
        case "yarn": return `yarn global add ${tool.packageName}`;
        case "brew": return `brew upgrade ${brewFormula || tool.name}`;
        case "pip": return tool.installCommand;
        default: return tool.installCommand;
    }
}
async function getInstalledVersion(tool) {
    try {
        const { stdout } = await execAsync(tool.checkCommand, { timeout: 5000 });
        return parseVersion(stdout.trim());
    }
    catch {
        return undefined;
    }
}
async function getLatestNpmVersion(packageName) {
    try {
        const { stdout } = await execAsync(`npm view ${packageName} version 2>/dev/null`, { timeout: 10000 });
        return stdout.trim() || undefined;
    }
    catch {
        return undefined;
    }
}
async function getLatestPipVersion(packageName) {
    try {
        const { stdout } = await execAsync(`pip index versions ${packageName} 2>/dev/null | head -1`, { timeout: 10000, shell: "/bin/bash" });
        const match = stdout.trim().match(/\(([^)]+)\)/);
        return match ? match[1] : undefined;
    }
    catch {
        return undefined;
    }
}
async function getLatestVersion(tool) {
    return tool.packageManager === "npm"
        ? getLatestNpmVersion(tool.packageName)
        : getLatestPipVersion(tool.packageName);
}
function compareVersions(v1, v2) {
    const parts1 = v1.split(/[-.]/).map((p) => parseInt(p, 10) || 0);
    const parts2 = v2.split(/[-.]/).map((p) => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2)
            return -1;
        if (p1 > p2)
            return 1;
    }
    return 0;
}
// ─── Component ─────────────────────────────────────────────────────────────────
export function CliToolsScreen() {
    const { state, dispatch } = useApp();
    const { cliTools: cliToolsState } = state;
    const modal = useModal();
    const dimensions = useDimensions();
    const [toolStatuses, setToolStatuses] = useState(() => {
        return (cachedToolStatuses ||
            cliTools.map((tool) => ({
                tool,
                installed: false,
                installedVersion: undefined,
                checking: true,
            })));
    });
    const statusesRef = useRef(toolStatuses);
    statusesRef.current = toolStatuses;
    const updateToolStatus = useCallback((index, updates) => {
        setToolStatuses((prev) => {
            const newStatuses = [...prev];
            newStatuses[index] = { ...newStatuses[index], ...updates };
            cachedToolStatuses = newStatuses;
            return newStatuses;
        });
    }, []);
    const fetchVersionInfo = useCallback(async () => {
        for (let i = 0; i < cliTools.length; i++) {
            const tool = cliTools[i];
            // Run all checks in parallel, then update with all results
            Promise.all([
                getInstalledVersion(tool),
                getLatestVersion(tool),
                detectInstallMethods(tool),
            ]).then(([version, latest, info]) => {
                updateToolStatus(i, {
                    installedVersion: version,
                    installed: version !== undefined,
                    latestVersion: latest,
                    checking: false,
                    hasUpdate: version && latest
                        ? compareVersions(version, latest) < 0
                        : false,
                    installMethod: version ? info.primary : undefined,
                    allMethods: version && info.all.length > 1 ? info.all : undefined,
                    updateCommand: version ? getUpdateCommand(tool, info.primary, info.brewFormula) : undefined,
                    brewFormula: info.brewFormula,
                });
            });
        }
    }, [updateToolStatus]);
    useEffect(() => {
        if (!cacheInitialized) {
            cacheInitialized = true;
            cachedToolStatuses = toolStatuses;
            fetchVersionInfo();
        }
    }, [fetchVersionInfo, toolStatuses]);
    useKeyboard((event) => {
        if (state.isSearching || state.modal)
            return;
        if (event.name === "up" || event.name === "k") {
            const newIndex = Math.max(0, cliToolsState.selectedIndex - 1);
            dispatch({ type: "CLITOOLS_SELECT", index: newIndex });
        }
        else if (event.name === "down" || event.name === "j") {
            const newIndex = Math.min(toolStatuses.length - 1, cliToolsState.selectedIndex + 1);
            dispatch({ type: "CLITOOLS_SELECT", index: newIndex });
        }
        else if (event.name === "r") {
            handleRefresh();
        }
        else if (event.name === "a") {
            handleUpdateAll();
        }
        else if (event.name === "c") {
            handleResolveConflict();
        }
        else if (event.name === "enter" || event.name === "return") {
            handleInstall();
        }
    });
    const handleRefresh = () => {
        clearCliToolsCache();
        setToolStatuses(cliTools.map((tool) => ({
            tool,
            installed: false,
            installedVersion: undefined,
            checking: true,
        })));
        cacheInitialized = false;
        fetchVersionInfo();
    };
    const runCommand = async (command) => {
        try {
            await execAsync(command, {
                shell: "/bin/bash",
                timeout: 60000,
            });
            return { ok: true };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, error: msg };
        }
    };
    const handleInstall = async () => {
        const status = toolStatuses[cliToolsState.selectedIndex];
        if (!status)
            return;
        const { tool, installed, hasUpdate, updateCommand } = status;
        const action = !installed ? "Installing" : hasUpdate ? "Updating" : "Reinstalling";
        const command = installed && updateCommand ? updateCommand : tool.installCommand;
        modal.loading(`${action} ${tool.displayName}...`);
        const result = await runCommand(command);
        modal.hideModal();
        if (result.ok) {
            handleRefresh();
        }
        else {
            await modal.message("Error", `Failed to ${action.toLowerCase()} ${tool.displayName}.\n\nTry running manually:\n${command}`, "error");
        }
    };
    const handleResolveConflict = async () => {
        const status = toolStatuses[cliToolsState.selectedIndex];
        if (!status || !status.allMethods || status.allMethods.length < 2)
            return;
        const { tool, allMethods, installMethod, brewFormula } = status;
        // Let user pick which install to keep
        const options = allMethods.map((method) => ({
            label: `Keep ${method}${method === installMethod ? " (active)" : ""}, remove others`,
            value: method,
        }));
        const keep = await modal.select(`Resolve ${tool.displayName} conflict`, `Installed via ${allMethods.join(" + ")}. Which to keep?`, options);
        if (keep === null)
            return;
        const toRemove = allMethods.filter((m) => m !== keep);
        modal.loading(`Removing ${toRemove.join(", ")} install(s)...`);
        const errors = [];
        for (const method of toRemove) {
            const cmd = getUninstallCommand(tool, method, brewFormula);
            if (!cmd)
                continue;
            const result = await runCommand(cmd);
            if (!result.ok)
                errors.push(`${method}: ${cmd}`);
        }
        modal.hideModal();
        if (errors.length > 0) {
            await modal.message("Partial", `Some removals failed. Try manually:\n\n${errors.join("\n")}`, "error");
        }
        handleRefresh();
    };
    const handleUpdateAll = async () => {
        const updatable = toolStatuses.filter((s) => s.hasUpdate);
        if (updatable.length === 0) {
            await modal.message("Up to Date", "All tools are already up to date.", "info");
            return;
        }
        modal.loading(`Updating ${updatable.length} tool(s)...`);
        for (const status of updatable) {
            const command = status.updateCommand || status.tool.installCommand;
            await runCommand(command);
        }
        modal.hideModal();
        handleRefresh();
    };
    const selectedStatus = toolStatuses[cliToolsState.selectedIndex];
    const installedCount = toolStatuses.filter((s) => s.installed).length;
    const updateCount = toolStatuses.filter((s) => s.hasUpdate).length;
    const statusContent = (_jsxs("text", { children: [_jsx("span", { fg: "gray", children: "Installed: " }), _jsxs("span", { fg: "cyan", children: [installedCount, "/", toolStatuses.length] }), updateCount > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { fg: "gray", children: " \u2502 Updates: " }), _jsx("span", { fg: "yellow", children: updateCount })] }))] }));
    return (_jsx(ScreenLayout, { title: "claudeup CLI Tools", currentScreen: "cli-tools", statusLine: statusContent, footerHints: "Enter:install \u2502 a:update all \u2502 c:fix conflict \u2502 r:refresh", listPanel: _jsx(ScrollableList, { items: toolStatuses, selectedIndex: cliToolsState.selectedIndex, renderItem: renderCliToolRow, maxHeight: dimensions.listPanelHeight }), detailPanel: renderCliToolDetail(selectedStatus) }));
}
export default CliToolsScreen;
