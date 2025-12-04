import blessed from 'neo-blessed';
import { execSync } from 'child_process';
import type { AppState } from '../app.js';
import { createHeader, createFooter, showMessage } from '../app.js';
import { cliTools, type CliTool } from '../../data/cli-tools.js';

interface ToolStatus {
  tool: CliTool;
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
}

function parseVersion(versionOutput: string): string | undefined {
  // Extract version number from various formats like "v1.2.3", "1.2.3", "aider 0.82.0"
  const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  return match ? match[1] : undefined;
}

async function getInstalledVersion(tool: CliTool): Promise<string | undefined> {
  try {
    const output = execSync(tool.checkCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return parseVersion(output);
  } catch {
    return undefined;
  }
}

async function getLatestNpmVersion(packageName: string): Promise<string | undefined> {
  try {
    const output = execSync(`npm view ${packageName} version 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

async function getLatestPipVersion(packageName: string): Promise<string | undefined> {
  try {
    const output = execSync(`pip index versions ${packageName} 2>/dev/null | head -1`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
    }).trim();
    // Output format: "package (x.y.z)"
    const match = output.match(/\(([^)]+)\)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

async function getLatestVersion(tool: CliTool): Promise<string | undefined> {
  if (tool.packageManager === 'npm') {
    return getLatestNpmVersion(tool.packageName);
  } else {
    return getLatestPipVersion(tool.packageName);
  }
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(/[-.]/).map((p) => parseInt(p, 10) || 0);
  const parts2 = v2.split(/[-.]/).map((p) => parseInt(p, 10) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

async function checkToolStatus(tool: CliTool): Promise<ToolStatus> {
  const installedVersion = await getInstalledVersion(tool);
  const installed = installedVersion !== undefined;

  return {
    tool,
    installed,
    installedVersion,
  };
}

export async function createCliToolsScreen(state: AppState): Promise<void> {
  createHeader(state, 'CLI Tools');

  const toolStatuses: ToolStatus[] = [];

  // Show loading indicator
  const loadingBox = blessed.box({
    parent: state.screen,
    top: 'center',
    left: 'center',
    width: 40,
    height: 3,
    content: '{center}Checking installed tools...{/center}',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
  });
  state.screen.render();

  // Check installed status first (fast)
  const statuses = await Promise.all(cliTools.map(checkToolStatus));
  toolStatuses.push(...statuses);

  // Update loading message
  loadingBox.setContent('{center}Checking for updates...{/center}');
  state.screen.render();

  // Fetch latest versions in parallel (slower, network)
  const latestVersions = await Promise.all(
    cliTools.map((tool) => getLatestVersion(tool).catch(() => undefined))
  );

  // Update statuses with latest versions
  for (let i = 0; i < toolStatuses.length; i++) {
    const status = toolStatuses[i];
    const latest = latestVersions[i];
    status.latestVersion = latest;
    if (status.installedVersion && latest) {
      status.hasUpdate = compareVersions(status.installedVersion, latest) < 0;
    }
  }

  loadingBox.destroy();

  // Build list items
  const buildListItems = (): string[] => {
    return toolStatuses.map((status) => {
      let icon: string;
      let versionInfo = '';

      if (!status.installed) {
        icon = '{gray-fg}○{/gray-fg}';
        if (status.latestVersion) {
          versionInfo = ` {gray-fg}v${status.latestVersion}{/gray-fg}`;
        }
      } else if (status.hasUpdate) {
        icon = '{yellow-fg}↑{/yellow-fg}';
        versionInfo = ` {yellow-fg}v${status.installedVersion}{/yellow-fg} → {green-fg}v${status.latestVersion}{/green-fg}`;
      } else {
        icon = '{green-fg}●{/green-fg}';
        if (status.installedVersion) {
          versionInfo = ` {green-fg}v${status.installedVersion}{/green-fg}`;
        }
      }

      return `${icon} {bold}${status.tool.displayName}{/bold}${versionInfo}`;
    });
  };

  // List
  const list = blessed.list({
    parent: state.screen,
    top: 3,
    left: 2,
    width: '50%-2',
    height: '100%-5',
    items: buildListItems(),
    keys: true,
    vi: false,
    mouse: true,
    tags: true,
    scrollable: true,
    border: { type: 'line' },
    style: {
      selected: { bg: 'magenta', fg: 'white' },
      border: { fg: 'gray' },
    },
    scrollbar: { ch: '|', style: { bg: 'gray' } },
    label: ' AI Coding Tools ',
  });

  // Detail panel
  const detailBox = blessed.box({
    parent: state.screen,
    top: 3,
    right: 2,
    width: '50%-2',
    height: '100%-5',
    content: '',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
    label: ' Details ',
  });

  // Update detail panel
  const updateDetail = (): void => {
    const selected = list.selected as number;
    const status = toolStatuses[selected];
    if (!status) return;

    const { tool, installed, installedVersion, latestVersion, hasUpdate } = status;

    let statusText: string;
    if (!installed) {
      statusText = '{gray-fg}Not installed{/gray-fg}';
    } else if (hasUpdate) {
      statusText = `{yellow-fg}Update available{/yellow-fg}`;
    } else {
      statusText = '{green-fg}Up to date{/green-fg}';
    }

    let versionText = '';
    if (installedVersion) {
      versionText += `{bold}Installed:{/bold} {green-fg}v${installedVersion}{/green-fg}\n`;
    }
    if (latestVersion) {
      versionText += `{bold}Latest:{/bold} {cyan-fg}v${latestVersion}{/cyan-fg}\n`;
    }

    let actionText: string;
    if (!installed) {
      actionText = '{green-fg}Press Enter to install{/green-fg}';
    } else if (hasUpdate) {
      actionText = '{yellow-fg}Press Enter to update{/yellow-fg}';
    } else {
      actionText = '{gray-fg}Press Enter to reinstall{/gray-fg}';
    }

    const content = `
{bold}{cyan-fg}${tool.displayName}{/cyan-fg}{/bold}

${tool.description}

{bold}Status:{/bold} ${statusText}
${versionText}
{bold}Install:{/bold}
{gray-fg}${tool.installCommand}{/gray-fg}

{bold}Website:{/bold}
{cyan-fg}${tool.website}{/cyan-fg}

${actionText}
    `.trim();

    detailBox.setContent(content);
    state.screen.render();
  };

  list.on('select item', updateDetail);
  setTimeout(updateDetail, 0);

  // Install/Update on Enter
  list.on('select', async (_item: unknown, index: number) => {
    const status = toolStatuses[index];
    if (!status) return;

    const { tool, installed, hasUpdate } = status;
    const action = !installed ? 'Installing' : hasUpdate ? 'Updating' : 'Reinstalling';

    await showMessage(
      state,
      action,
      `Running: ${tool.installCommand}\n\nThis may take a moment...`,
      'info'
    );

    try {
      execSync(tool.installCommand, {
        encoding: 'utf-8',
        stdio: 'inherit',
        shell: '/bin/bash',
      });

      await showMessage(
        state,
        'Success',
        `${tool.displayName} has been ${action.toLowerCase().replace('ing', 'ed')}.`,
        'success'
      );
    } catch (error) {
      await showMessage(
        state,
        'Error',
        `Failed to install ${tool.displayName}.\n\nTry running manually:\n${tool.installCommand}`,
        'error'
      );
    }

    // Refresh screen
    createCliToolsScreen(state);
  });

  // Navigation
  list.key(['j'], () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list as any).down();
    state.screen.render();
  });
  list.key(['k'], () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list as any).up();
    state.screen.render();
  });

  // Refresh
  list.key(['r'], () => {
    createCliToolsScreen(state);
  });

  // Update all
  list.key(['a'], async () => {
    const updatable = toolStatuses.filter((s) => s.hasUpdate);
    if (updatable.length === 0) {
      await showMessage(state, 'All Up to Date', 'All tools are at the latest version.', 'info');
      return;
    }

    await showMessage(
      state,
      'Updating All',
      `Updating ${updatable.length} tool(s)...\n\nThis may take a while.`,
      'info'
    );

    for (const status of updatable) {
      try {
        execSync(status.tool.installCommand, {
          encoding: 'utf-8',
          stdio: 'inherit',
          shell: '/bin/bash',
        });
      } catch {
        // Continue with other updates
      }
    }

    await showMessage(state, 'Done', `Updated ${updatable.length} tool(s).`, 'success');
    createCliToolsScreen(state);
  });

  // Legend
  blessed.box({
    parent: state.screen,
    bottom: 1,
    right: 2,
    width: 50,
    height: 1,
    content: '{green-fg}●{/green-fg} Installed  {yellow-fg}↑{/yellow-fg} Update  {gray-fg}○{/gray-fg} Not installed',
    tags: true,
  });

  createFooter(state, '↑↓ Navigate │ Enter Install/Update │ a Update All │ r Refresh │ q Back');

  list.focus();
  state.screen.render();
}
