/**
 * Doctor Service
 *
 * Cross-project audit of convention compliance.
 * Reads installed_plugins.json to enumerate all projects, checks each for
 * .gitignore completeness and CLAUDE.md convention blocks.
 * Detects and reports malformed markers, duplicate sections, and missing END markers.
 *
 * Dependencies:
 * - claude-settings.js (readInstalledPluginsRegistry)
 * - conventions-manager.js (check/apply functions)
 * - plugin-manager.js (resolve plugin source paths)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readInstalledPluginsRegistry } from './claude-settings.js';
import { getLocalMarketplacesInfo } from './plugin-manager.js';
import {
  checkGitignoreEntries,
  ensureGitignoreEntries,
  parseClaudeMdSections,
  resolvePluginConventions,
  readConventionTemplate,
  injectClaudeMdSection,
  removeClaudeMdSection,
} from './conventions-manager.js';
import { parsePluginId } from '../utils/string-utils.js';
import type { PluginConventions } from '../types/index.js';

// ============================================================
// TYPES
// ============================================================

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  fixable: boolean;
  /** Metadata used by fixDoctorIssues to know what to fix */
  _fixData?: unknown;
}

export interface ProjectDoctorResult {
  projectPath: string;
  checks: DoctorCheck[];
  plugins: string[];
}

export interface DoctorResult {
  projects: ProjectDoctorResult[];
  summary: {
    totalProjects: number;
    totalChecks: number;
    passed: number;
    warnings: number;
    failures: number;
    fixable: number;
  };
}

export type DoctorLogger = (level: 'info' | 'warn' | 'error', message: string) => void;

// ============================================================
// INTERNAL HELPERS
// ============================================================

import { homedir } from 'node:os';

/** Path constants matching plugin-manager.ts */
const MARKETPLACES_DIR = join(homedir(), '.claude', 'plugins', 'marketplaces');

/**
 * Resolve a plugin ID to its filesystem source path.
 * Mirrors the private resolvePluginSourcePath in plugin-manager.ts.
 */
async function resolvePluginPath(pluginId: string): Promise<string | null> {
  const parsed = parsePluginId(pluginId);
  if (!parsed) return null;

  const { pluginName, marketplace: mpName } = parsed;
  const localMarketplaces = await getLocalMarketplacesInfo();
  const localMp = localMarketplaces.get(mpName);
  if (!localMp) return null;

  const localPlugin = localMp.plugins.find((p) => p.name === pluginName);
  if (!localPlugin?.source || typeof localPlugin.source !== 'string') return null;

  const marketplacePath = join(MARKETPLACES_DIR, mpName);
  const pluginPath = join(marketplacePath, localPlugin.source.replace('./', ''));

  if (existsSync(pluginPath)) {
    return pluginPath;
  }

  return null;
}

/**
 * Collect all unique project paths from the installed plugins registry,
 * along with the plugin IDs installed in each project.
 */
async function collectProjects(): Promise<Map<string, string[]>> {
  const registry = await readInstalledPluginsRegistry();
  const projectMap = new Map<string, string[]>();

  for (const [pluginId, entries] of Object.entries(registry.plugins)) {
    for (const entry of entries) {
      if (entry.projectPath) {
        if (!projectMap.has(entry.projectPath)) {
          projectMap.set(entry.projectPath, []);
        }
        projectMap.get(entry.projectPath)!.push(pluginId);
      }
    }
  }

  return projectMap;
}

/**
 * Resolve conventions for a plugin, returning both the conventions object
 * and the plugin source path.
 */
async function resolveConventionsForPlugin(
  pluginId: string,
): Promise<{ conventions: PluginConventions | null; pluginPath: string | null }> {
  const pluginPath = await resolvePluginPath(pluginId);
  if (!pluginPath) {
    return { conventions: null, pluginPath: null };
  }

  const conventions = await resolvePluginConventions(pluginPath);
  return { conventions, pluginPath };
}

// ============================================================
// CHECK PROJECT
// ============================================================

/**
 * Run doctor checks on a single project.
 *
 * @param projectPath - Absolute path to project
 * @param pluginIds - Plugin IDs installed in this project
 * @param logger - Optional logger
 * @returns Check results for this project
 */
export async function checkProject(
  projectPath: string,
  pluginIds: string[],
  logger?: DoctorLogger,
): Promise<ProjectDoctorResult> {
  const checks: DoctorCheck[] = [];

  // Check 6: Project path is accessible
  if (!existsSync(projectPath)) {
    checks.push({
      name: 'project-accessible',
      status: 'fail',
      message: 'Project path does not exist',
      fixable: false,
    });
    return { projectPath, checks, plugins: pluginIds };
  }

  // Aggregate all required gitignore entries and claudemd conventions across plugins
  const allGitignoreEntries: string[] = [];
  const pluginConventionsMap = new Map<
    string,
    { conventions: PluginConventions; pluginPath: string }
  >();

  for (const pluginId of pluginIds) {
    const { conventions, pluginPath } = await resolveConventionsForPlugin(pluginId);
    if (conventions && pluginPath) {
      const parsed = parsePluginId(pluginId);
      if (parsed) {
        pluginConventionsMap.set(parsed.pluginName, { conventions, pluginPath });
      }

      if (conventions.gitignore?.project) {
        allGitignoreEntries.push(...conventions.gitignore.project);
      }
    }
  }

  // Check 1: .gitignore exists
  const gitignorePath = join(projectPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    if (allGitignoreEntries.length > 0) {
      checks.push({
        name: 'gitignore-exists',
        status: 'warn',
        message: '.gitignore does not exist',
        fixable: true,
        _fixData: { type: 'create-gitignore', projectPath, entries: allGitignoreEntries },
      });
    }
  } else if (allGitignoreEntries.length > 0) {
    // Check 2: Required gitignore entries present
    const { missing } = await checkGitignoreEntries(gitignorePath, allGitignoreEntries);
    if (missing.length > 0) {
      checks.push({
        name: 'gitignore-entries',
        status: 'fail',
        message: `.gitignore missing: ${missing.join(', ')}`,
        fixable: true,
        _fixData: { type: 'add-gitignore-entries', gitignorePath, entries: missing },
      });
    } else {
      checks.push({
        name: 'gitignore-entries',
        status: 'pass',
        message: '.gitignore has all required entries',
        fixable: false,
      });
    }
  }

  // Check 5: CLAUDE.md markers well-formed (run before section checks)
  const claudeMdPath = join(projectPath, 'CLAUDE.md');
  let hasMarkerErrors = false;

  if (existsSync(claudeMdPath)) {
    const parseResult = await parseClaudeMdSections(claudeMdPath);

    if (parseResult.errors.length > 0) {
      hasMarkerErrors = true;
      const errorDesc = parseResult.errors
        .map((e) => {
          if (e.type === 'missing_end') return `missing END for "${e.section}"`;
          if (e.type === 'mismatched_end') return `mismatched END for "${e.section}" (expected "${(e as { expected: string }).expected}")`;
          if (e.type === 'duplicate_section') return `duplicate section "${e.section}"`;
          if (e.type === 'marker_in_code_block') return `marker for "${e.section}" inside code block`;
          return 'unknown error';
        })
        .join('; ');

      checks.push({
        name: 'claudemd-markers',
        status: 'fail',
        message: `CLAUDE.md has malformed markers: ${errorDesc}`,
        fixable: true,
        _fixData: {
          type: 'repair-markers',
          claudeMdPath,
          errors: parseResult.errors,
          pluginConventionsMap: Object.fromEntries(pluginConventionsMap),
        },
      });
    }

    // Check 3 & 4: CLAUDE.md convention sections present and current
    if (!hasMarkerErrors) {
      for (const [pluginName, { conventions, pluginPath }] of pluginConventionsMap) {
        if (!conventions.claudemd) continue;

        const existingSection = parseResult.sections.find((s) => s.section === pluginName);

        if (!existingSection) {
          checks.push({
            name: `claudemd-section-${pluginName}`,
            status: 'warn',
            message: `CLAUDE.md missing ${pluginName} conventions`,
            fixable: true,
            _fixData: {
              type: 'inject-section',
              claudeMdPath,
              pluginName,
              pluginPath,
              conventions,
            },
          });
        } else if (existingSection.version !== conventions.claudemd.version) {
          checks.push({
            name: `claudemd-section-${pluginName}`,
            status: 'warn',
            message: `CLAUDE.md ${pluginName} conventions outdated (v${existingSection.version} -> v${conventions.claudemd.version})`,
            fixable: true,
            _fixData: {
              type: 'update-section',
              claudeMdPath,
              pluginName,
              pluginPath,
              conventions,
            },
          });
        } else {
          checks.push({
            name: `claudemd-section-${pluginName}`,
            status: 'pass',
            message: `CLAUDE.md has ${pluginName} conventions (v${conventions.claudemd.version})`,
            fixable: false,
          });
        }
      }
    }
  } else {
    // CLAUDE.md doesn't exist -- warn for each plugin that needs a section
    for (const [pluginName, { conventions, pluginPath }] of pluginConventionsMap) {
      if (!conventions.claudemd) continue;

      checks.push({
        name: `claudemd-section-${pluginName}`,
        status: 'warn',
        message: `CLAUDE.md missing ${pluginName} conventions`,
        fixable: true,
        _fixData: {
          type: 'inject-section',
          claudeMdPath,
          pluginName,
          pluginPath,
          conventions,
        },
      });
    }
  }

  logger?.('info', `Checked ${projectPath}: ${checks.length} checks`);

  return { projectPath, checks, plugins: pluginIds };
}

// ============================================================
// RUN DOCTOR
// ============================================================

/**
 * Run doctor checks across all registered projects.
 *
 * @param logger - Optional logger
 * @returns Full doctor result with per-project checks and summary
 */
export async function runDoctor(
  logger?: DoctorLogger,
): Promise<DoctorResult> {
  const projectMap = await collectProjects();

  logger?.('info', `Found ${projectMap.size} project(s) to check`);

  const projects: ProjectDoctorResult[] = [];

  for (const [projectPath, pluginIds] of projectMap) {
    const result = await checkProject(projectPath, pluginIds, logger);
    projects.push(result);
  }

  // Compute summary
  let totalChecks = 0;
  let passed = 0;
  let warnings = 0;
  let failures = 0;
  let fixable = 0;

  for (const project of projects) {
    for (const check of project.checks) {
      totalChecks++;
      if (check.status === 'pass') passed++;
      else if (check.status === 'warn') warnings++;
      else if (check.status === 'fail') failures++;
      if (check.fixable) fixable++;
    }
  }

  return {
    projects,
    summary: {
      totalProjects: projects.length,
      totalChecks,
      passed,
      warnings,
      failures,
      fixable,
    },
  };
}

// ============================================================
// FIX DOCTOR ISSUES
// ============================================================

/**
 * Fix all fixable issues found by doctor.
 * For malformed CLAUDE.md markers: removes the broken section and re-injects cleanly.
 *
 * @param result - Doctor result from runDoctor()
 * @param logger - Optional logger
 * @returns Number of issues fixed and failed
 */
export async function fixDoctorIssues(
  result: DoctorResult,
  logger?: DoctorLogger,
): Promise<{ fixed: number; failed: number }> {
  let fixed = 0;
  let failed = 0;

  for (const project of result.projects) {
    for (const check of project.checks) {
      if (!check.fixable || check.status === 'pass') continue;

      const fixData = check._fixData as Record<string, unknown> | undefined;
      if (!fixData) {
        failed++;
        continue;
      }

      try {
        switch (fixData.type) {
          case 'create-gitignore':
          case 'add-gitignore-entries': {
            const gitignorePath =
              fixData.type === 'create-gitignore'
                ? join(fixData.projectPath as string, '.gitignore')
                : (fixData.gitignorePath as string);
            const entries = fixData.entries as string[];

            await ensureGitignoreEntries(gitignorePath, entries, '# Managed by magus plugin conventions');
            logger?.('info', `Fixed: added ${entries.join(', ')} to ${gitignorePath}`);
            fixed++;
            break;
          }

          case 'inject-section':
          case 'update-section': {
            const claudeMdPath = fixData.claudeMdPath as string;
            const pluginPath = fixData.pluginPath as string;
            const conventions = fixData.conventions as PluginConventions;

            if (!conventions.claudemd) {
              failed++;
              break;
            }

            const template = await readConventionTemplate(pluginPath, conventions.claudemd.template);
            const injectResult = await injectClaudeMdSection(
              claudeMdPath,
              conventions.claudemd.section,
              conventions.claudemd.version,
              template,
            );

            if (injectResult.action === 'error') {
              logger?.('error', `Failed to fix ${claudeMdPath}: ${injectResult.error}`);
              failed++;
            } else {
              logger?.('info', `Fixed: ${injectResult.action} ${conventions.claudemd.section} in ${claudeMdPath}`);
              fixed++;
            }
            break;
          }

          case 'repair-markers': {
            const claudeMdPath = fixData.claudeMdPath as string;
            const errors = fixData.errors as Array<{ type: string; section: string }>;
            const conventionsMap = fixData.pluginConventionsMap as Record<
              string,
              { conventions: PluginConventions; pluginPath: string }
            >;

            // Collect unique sections with errors
            const brokenSections = new Set(errors.map((e) => e.section));

            for (const section of brokenSections) {
              // Remove the broken section (force=true to bypass parse error guard)
              await removeClaudeMdSection(claudeMdPath, section, { force: true });

              // Re-inject if we have conventions for it
              const entry = conventionsMap[section];
              if (entry?.conventions?.claudemd) {
                try {
                  const template = await readConventionTemplate(
                    entry.pluginPath,
                    entry.conventions.claudemd.template,
                  );
                  await injectClaudeMdSection(
                    claudeMdPath,
                    entry.conventions.claudemd.section,
                    entry.conventions.claudemd.version,
                    template,
                  );
                } catch (reInjectErr) {
                  const reInjectMsg = reInjectErr instanceof Error ? reInjectErr.message : String(reInjectErr);
                  logger?.('warn', `Re-inject of section "${section}" failed after marker repair: ${reInjectMsg}`);
                }
              }
            }

            logger?.('info', `Fixed: repaired malformed markers in ${claudeMdPath}`);
            fixed++;
            break;
          }

          default:
            failed++;
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.('error', `Fix failed: ${message}`);
        failed++;
      }
    }
  }

  return { fixed, failed };
}
