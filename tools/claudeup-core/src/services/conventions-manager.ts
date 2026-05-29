/**
 * Convention Manager Service
 *
 * All business logic for reading conventions from plugin.json,
 * manipulating .gitignore files, and injecting/removing CLAUDE.md sections.
 *
 * Design principles:
 * - Pure functions where possible (gitignore deduplication, marker parsing)
 * - Side-effecting functions take explicit paths (no process.cwd())
 * - File locking for all write operations
 * - All operations are idempotent
 * - Atomic writes: write-to-temp-and-rename under lock
 * - Line-oriented state machine for CLAUDE.md marker parsing
 */

import { readFile, writeFile, stat, rename, unlink, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { withFileLock } from '../utils/file-locking.js';
import type { PluginConventions } from '../types/index.js';

// ============================================================
// TYPES
// ============================================================

/** A successfully parsed managed section from CLAUDE.md */
export interface ParsedSection {
  section: string;
  version: string | null;
  content: string;
  startLine: number;
  endLine: number;
  insideCodeBlock: boolean;
}

/** Parse error types for CLAUDE.md markers */
export type ParseError =
  | { type: 'missing_end'; section: string; startLine: number }
  | { type: 'mismatched_end'; section: string; expected: string; line: number }
  | { type: 'duplicate_section'; section: string; lines: number[] }
  | { type: 'marker_in_code_block'; section: string; line: number };

/** Result from parseClaudeMdSections */
export interface ParseResult {
  sections: ParsedSection[];
  errors: ParseError[];
}

/** Logger for convention operations */
export type ConventionLogger = (level: 'info' | 'warn' | 'error', message: string) => void;

// ============================================================
// MARKER PATTERNS
// ============================================================

const BEGIN_MARKER_RE = /^<!--\s*BEGIN\s+magus:([\w-]+)\s+v([\w.+-]+)\s*-->$/;
const END_MARKER_RE = /^<!--\s*END\s+magus:([\w-]+)\s*-->$/;
const CODE_FENCE_RE = /^(`{3,}|~{3,})/;

// ============================================================
// ATOMIC FILE WRITE
// ============================================================

/**
 * Write file atomically using write-to-temp-and-rename.
 * Crash-safe: if the process crashes during write, the temp file is left
 * behind (not the corrupted target). On next run, temp files are cleaned up.
 *
 * @param targetPath - Absolute path to the target file
 * @param content - Content to write
 */
async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const dir = dirname(targetPath);
  const tmpPath = join(dir, `.${basename(targetPath)}.tmp.${randomUUID()}`);

  try {
    // Preserve original file permissions if file exists
    let mode: number | undefined;
    try {
      const fileStat = await stat(targetPath);
      mode = fileStat.mode;
    } catch {
      // File doesn't exist yet, use default permissions
    }

    // Write to temp file
    await writeFile(tmpPath, content, { mode: mode ?? 0o644 });

    // fsync to ensure content is on disk before rename
    const fd = await open(tmpPath, 'r');
    await fd.sync();
    await fd.close();

    // Atomic rename (same filesystem guaranteed since same directory)
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Read file contents, returning empty string if file does not exist.
 */
async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw err;
  }
}

// ============================================================
// GITIGNORE OPERATIONS
// ============================================================

/**
 * Ensure entries exist in a .gitignore file.
 * Creates the file if it doesn't exist.
 * Idempotent: skips entries that are already present.
 * Uses atomic write-to-temp-and-rename under file lock.
 *
 * @param gitignorePath - Absolute path to .gitignore file
 * @param entries - Array of gitignore patterns to add
 * @param comment - Optional comment header (e.g., "# Code Analysis plugin")
 * @returns Object with added entries and whether file was modified
 */
export async function ensureGitignoreEntries(
  gitignorePath: string,
  entries: string[],
  comment?: string,
): Promise<{ added: string[]; modified: boolean }> {
  if (entries.length === 0) {
    return { added: [], modified: false };
  }

  return withFileLock(gitignorePath, async () => {
    const content = await readFileOrEmpty(gitignorePath);
    const lines = content.split('\n');

    // Build a Set of existing patterns (trimmed, ignoring comments and blank lines)
    const existingPatterns = new Set<string>();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        existingPatterns.add(trimmed);
      }
    }

    // Find entries that need to be added
    const toAdd = entries.filter((entry) => !existingPatterns.has(entry.trim()));

    if (toAdd.length === 0) {
      return { added: [], modified: false };
    }

    // Build the append block
    const appendLines: string[] = [];

    // Add comment if provided and not already in the file
    if (comment) {
      const commentExists = lines.some((line) => line.trim() === comment.trim());
      if (!commentExists) {
        appendLines.push(comment);
      }
    }

    for (const entry of toAdd) {
      appendLines.push(entry);
    }

    // Ensure existing content ends with a newline before appending
    let newContent = content;
    if (newContent.length > 0 && !newContent.endsWith('\n')) {
      newContent += '\n';
    }

    // Add blank line separator if file has content
    if (newContent.trim().length > 0) {
      newContent += '\n';
    }

    newContent += appendLines.join('\n') + '\n';

    await atomicWrite(gitignorePath, newContent);

    return { added: toAdd, modified: true };
  });
}

/**
 * Remove entries from a .gitignore file.
 * No-op if file doesn't exist or entries are not present.
 *
 * @param gitignorePath - Absolute path to .gitignore file
 * @param entries - Array of gitignore patterns to remove
 * @returns Object with removed entries and whether file was modified
 */
export async function removeGitignoreEntries(
  gitignorePath: string,
  entries: string[],
): Promise<{ removed: string[]; modified: boolean }> {
  if (entries.length === 0) {
    return { removed: [], modified: false };
  }

  return withFileLock(gitignorePath, async () => {
    const content = await readFileOrEmpty(gitignorePath);
    if (!content) {
      return { removed: [], modified: false };
    }

    const entriesToRemove = new Set(entries.map((e) => e.trim()));
    const lines = content.split('\n');
    const removed: string[] = [];
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (entriesToRemove.has(trimmed)) {
        removed.push(trimmed);
      } else {
        newLines.push(line);
      }
    }

    if (removed.length === 0) {
      return { removed: [], modified: false };
    }

    await atomicWrite(gitignorePath, newLines.join('\n'));

    return { removed, modified: true };
  });
}

/**
 * Check which expected entries are missing from a .gitignore file.
 *
 * @param gitignorePath - Absolute path to .gitignore file
 * @param entries - Array of gitignore patterns to check
 * @returns Object with present and missing entries
 */
export async function checkGitignoreEntries(
  gitignorePath: string,
  entries: string[],
): Promise<{ present: string[]; missing: string[] }> {
  const content = await readFileOrEmpty(gitignorePath);
  const lines = content.split('\n');

  const existingPatterns = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      existingPatterns.add(trimmed);
    }
  }

  const present: string[] = [];
  const missing: string[] = [];

  for (const entry of entries) {
    if (existingPatterns.has(entry.trim())) {
      present.push(entry);
    } else {
      missing.push(entry);
    }
  }

  return { present, missing };
}

// ============================================================
// CLAUDE.MD PARSING — LINE-ORIENTED STATE MACHINE
// ============================================================

type ParserState = 'NORMAL' | 'IN_SECTION';

/**
 * Parse a CLAUDE.md file content using a line-oriented state machine.
 * Returns all managed sections and any parse errors.
 * Does NOT mutate the file.
 *
 * @param content - Raw CLAUDE.md file content
 * @returns ParseResult with sections and errors
 */
export function parseClaudeMdContent(content: string): ParseResult {
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  const errors: ParseError[] = [];

  let state: ParserState = 'NORMAL';
  let inCodeBlock = false;
  // Track active fence: delimiter char ('`' or '~') and minimum length to close
  let activeFenceChar = '';
  let activeFenceLen = 0;

  // Current section being accumulated
  let currentSection = '';
  let currentVersion: string | null = null;
  let currentStartLine = 0;
  let currentContentLines: string[] = [];

  // Track section names for duplicate detection
  const sectionLineMap = new Map<string, number[]>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based line numbers

    // Check for code fence open/close (CommonMark: matching delimiter family + sufficient length)
    const fenceMatch = line.trim().match(CODE_FENCE_RE);
    if (fenceMatch) {
      const fenceStr = fenceMatch[1]; // e.g. '```' or '~~~~'
      const fenceChar = fenceStr[0]; // '`' or '~'
      const fenceLen = fenceStr.length;

      if (!inCodeBlock) {
        // Opening a new code block
        inCodeBlock = true;
        activeFenceChar = fenceChar;
        activeFenceLen = fenceLen;
      } else if (fenceChar === activeFenceChar && fenceLen >= activeFenceLen) {
        // Closing: must be same delimiter family with at least the same length
        inCodeBlock = false;
        activeFenceChar = '';
        activeFenceLen = 0;
      }
      // Otherwise: different delimiter family or shorter length — ignore (stays in code block)
    }

    // Check for BEGIN marker
    const beginMatch = line.trim().match(BEGIN_MARKER_RE);
    if (beginMatch) {
      const sectionName = beginMatch[1];
      const version = beginMatch[2];

      if (inCodeBlock) {
        errors.push({ type: 'marker_in_code_block', section: sectionName, line: lineNum });
        continue;
      }

      // If we're already in a section, the previous one had no END marker
      if (state === 'IN_SECTION') {
        errors.push({ type: 'missing_end', section: currentSection, startLine: currentStartLine });
        // Close the previous section with an error
        sections.push({
          section: currentSection,
          version: currentVersion,
          content: currentContentLines.join('\n'),
          startLine: currentStartLine,
          endLine: lineNum - 1,
          insideCodeBlock: false,
        });
      }

      // Track for duplicate detection
      if (!sectionLineMap.has(sectionName)) {
        sectionLineMap.set(sectionName, []);
      }
      sectionLineMap.get(sectionName)!.push(lineNum);

      // Start new section
      state = 'IN_SECTION';
      currentSection = sectionName;
      currentVersion = version;
      currentStartLine = lineNum;
      currentContentLines = [];
      continue;
    }

    // Check for END marker
    const endMatch = line.trim().match(END_MARKER_RE);
    if (endMatch) {
      const sectionName = endMatch[1];

      if (inCodeBlock) {
        // Inside code block, skip
        continue;
      }

      if (state !== 'IN_SECTION') {
        // Orphan END marker, ignore silently
        continue;
      }

      // Verify END marker matches the currently open section
      if (sectionName !== currentSection) {
        errors.push({
          type: 'mismatched_end',
          section: sectionName,
          expected: currentSection,
          line: lineNum,
        });
        // Don't close the section — keep accumulating content
        continue;
      }

      // Close section
      sections.push({
        section: currentSection,
        version: currentVersion,
        content: currentContentLines.join('\n'),
        startLine: currentStartLine,
        endLine: lineNum,
        insideCodeBlock: false,
      });

      state = 'NORMAL';
      currentSection = '';
      currentVersion = null;
      currentContentLines = [];
      continue;
    }

    // Accumulate content lines if inside a section
    if (state === 'IN_SECTION') {
      currentContentLines.push(line);
    }
  }

  // After all lines: if still in a section, it's unclosed
  if (state === 'IN_SECTION') {
    errors.push({ type: 'missing_end', section: currentSection, startLine: currentStartLine });
    sections.push({
      section: currentSection,
      version: currentVersion,
      content: currentContentLines.join('\n'),
      startLine: currentStartLine,
      endLine: lines.length,
      insideCodeBlock: false,
    });
  }

  // Check for duplicate sections
  for (const [sectionName, lineNums] of sectionLineMap) {
    if (lineNums.length > 1) {
      errors.push({ type: 'duplicate_section', section: sectionName, lines: lineNums });
    }
  }

  return { sections, errors };
}

/**
 * Parse a CLAUDE.md file using the line-oriented state machine.
 * Reads file from disk. Returns all sections and any parse errors.
 *
 * @param claudeMdPath - Absolute path to CLAUDE.md file
 * @returns ParseResult with sections and errors
 */
export async function parseClaudeMdSections(claudeMdPath: string): Promise<ParseResult> {
  const content = await readFileOrEmpty(claudeMdPath);
  if (!content) {
    return { sections: [], errors: [] };
  }
  return parseClaudeMdContent(content);
}

// ============================================================
// CLAUDE.MD MUTATION OPERATIONS
// ============================================================

/**
 * Build a complete marker block for a section.
 */
function buildMarkerBlock(section: string, version: string, content: string): string {
  return `<!-- BEGIN magus:${section} v${version} -->\n${content}\n<!-- END magus:${section} -->`;
}

/**
 * Inject or update a managed section in CLAUDE.md.
 * Idempotent: if section exists with same version, no change.
 * If section exists with different version, replaces content.
 * If section doesn't exist, appends at end.
 * REFUSES to mutate if parse errors are detected (returns error).
 * Uses atomic write-to-temp-and-rename under file lock.
 *
 * @param claudeMdPath - Absolute path to CLAUDE.md file
 * @param section - Section identifier (must match plugin name)
 * @param version - Semantic version of the content
 * @param content - Markdown content to inject (without markers)
 * @returns Object indicating action taken, or error if file is malformed
 */
export async function injectClaudeMdSection(
  claudeMdPath: string,
  section: string,
  version: string,
  content: string,
): Promise<{
  action: 'inserted' | 'updated' | 'unchanged' | 'error';
  previousVersion?: string;
  error?: string;
}> {
  return withFileLock(claudeMdPath, async () => {
    const fileContent = await readFileOrEmpty(claudeMdPath);
    const parseResult = parseClaudeMdContent(fileContent);

    // Refuse if parse errors detected
    if (parseResult.errors.length > 0) {
      const errorSummary = parseResult.errors
        .map((e) => {
          if (e.type === 'missing_end') return `missing END for "${e.section}" at line ${e.startLine}`;
          if (e.type === 'mismatched_end') return `mismatched END for "${e.section}" (expected "${e.expected}") at line ${e.line}`;
          if (e.type === 'duplicate_section') return `duplicate section "${e.section}" at lines ${e.lines.join(', ')}`;
          if (e.type === 'marker_in_code_block') return `marker for "${e.section}" inside code block at line ${e.line}`;
          return 'unknown error';
        })
        .join('; ');
      return {
        action: 'error' as const,
        error: `File has malformed markers: ${errorSummary}. Use 'claudeup doctor --fix' to repair.`,
      };
    }

    // Find existing section
    const existing = parseResult.sections.find((s) => s.section === section);

    if (existing) {
      // Section exists -- check version
      if (existing.version === version) {
        return { action: 'unchanged' as const };
      }

      // Version changed -- replace the section
      const lines = fileContent.split('\n');
      const before = lines.slice(0, existing.startLine - 1);
      const after = lines.slice(existing.endLine);
      const newBlock = buildMarkerBlock(section, version, content);

      const newContent = [...before, newBlock, ...after].join('\n');
      await atomicWrite(claudeMdPath, newContent);

      return {
        action: 'updated' as const,
        previousVersion: existing.version ?? undefined,
      };
    }

    // Section doesn't exist -- append
    let newContent = fileContent;
    if (newContent.length > 0 && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    if (newContent.length > 0) {
      newContent += '\n';
    }
    newContent += buildMarkerBlock(section, version, content) + '\n';

    await atomicWrite(claudeMdPath, newContent);

    return { action: 'inserted' as const };
  });
}

/**
 * Remove a managed section from CLAUDE.md.
 * No-op if section doesn't exist or file doesn't exist.
 * REFUSES to mutate if parse errors are detected (returns error).
 * Uses atomic write under file lock.
 *
 * @param claudeMdPath - Absolute path to CLAUDE.md file
 * @param section - Section identifier to remove
 * @returns Whether a section was removed, or error if file is malformed
 */
export async function removeClaudeMdSection(
  claudeMdPath: string,
  section: string,
  options?: { force?: boolean },
): Promise<{ removed: boolean; error?: string }> {
  return withFileLock(claudeMdPath, async () => {
    const fileContent = await readFileOrEmpty(claudeMdPath);
    if (!fileContent) {
      return { removed: false };
    }

    const parseResult = parseClaudeMdContent(fileContent);

    // Refuse if parse errors detected (same guard as injectClaudeMdSection)
    // Unless force=true (used by doctor repair-markers to fix broken files)
    if (parseResult.errors.length > 0 && !options?.force) {
      const errorSummary = parseResult.errors
        .map((e) => {
          if (e.type === 'missing_end') return `missing END for "${e.section}" at line ${e.startLine}`;
          if (e.type === 'mismatched_end') return `mismatched END for "${e.section}" (expected "${e.expected}") at line ${e.line}`;
          if (e.type === 'duplicate_section') return `duplicate section "${e.section}" at lines ${e.lines.join(', ')}`;
          if (e.type === 'marker_in_code_block') return `marker for "${e.section}" inside code block at line ${e.line}`;
          return 'unknown error';
        })
        .join('; ');
      return {
        removed: false,
        error: `File has malformed markers: ${errorSummary}. Use 'claudeup doctor --fix' to repair.`,
      };
    }

    const existing = parseResult.sections.find((s) => s.section === section);

    if (!existing) {
      return { removed: false };
    }

    const lines = fileContent.split('\n');
    const before = lines.slice(0, existing.startLine - 1);
    const after = lines.slice(existing.endLine);

    // Clean up blank lines at the join point
    while (before.length > 0 && before[before.length - 1].trim() === '' && after.length > 0 && after[0].trim() === '') {
      after.shift();
    }

    const newContent = [...before, ...after].join('\n');
    await atomicWrite(claudeMdPath, newContent);

    return { removed: true };
  });
}

/**
 * List all managed sections in a CLAUDE.md file.
 *
 * @param claudeMdPath - Absolute path to CLAUDE.md file
 * @returns Array of section info (name, version, line range)
 */
export async function listClaudeMdSections(
  claudeMdPath: string,
): Promise<Array<{ section: string; version: string | null; startLine: number; endLine: number }>> {
  const parseResult = await parseClaudeMdSections(claudeMdPath);
  return parseResult.sections.map((s) => ({
    section: s.section,
    version: s.version,
    startLine: s.startLine,
    endLine: s.endLine,
  }));
}

// ============================================================
// GLOBAL GITIGNORE RESOLUTION
// ============================================================

/**
 * Resolve the path to the user's global gitignore file.
 * Uses `git config --global core.excludesfile` first,
 * falls back to $XDG_CONFIG_HOME/git/ignore or ~/.config/git/ignore.
 *
 * @returns Absolute path to global gitignore, or null if unresolvable
 */
export async function resolveGlobalGitignorePath(): Promise<string | null> {
  try {
    const { execSync } = await import('node:child_process');
    const configPath = execSync('git config --global core.excludesfile', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (configPath) {
      // Expand ~ to home directory
      const expanded = configPath.startsWith('~')
        ? join(homedir(), configPath.slice(1))
        : configPath;
      return resolve(expanded);
    }
  } catch {
    // git config returned empty or git not found
  }

  // Fallback: XDG_CONFIG_HOME/git/ignore or ~/.config/git/ignore
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfig, 'git', 'ignore');
}

// ============================================================
// CONVENTION AGGREGATION
// ============================================================

/**
 * Resolve conventions for a plugin by reading its plugin.json.
 * Returns null if plugin has no conventions field.
 *
 * @param pluginPath - Absolute path to plugin directory (containing plugin.json)
 * @returns Parsed conventions or null
 */
export async function resolvePluginConventions(
  pluginPath: string,
): Promise<PluginConventions | null> {
  const manifestPath = join(pluginPath, 'plugin.json');

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    if (!manifest.conventions || typeof manifest.conventions !== 'object') {
      return null;
    }

    return manifest.conventions as PluginConventions;
  } catch {
    return null;
  }
}

/**
 * Read template content for a plugin's CLAUDE.md conventions.
 *
 * @param pluginPath - Absolute path to plugin directory
 * @param templateRelPath - Relative path to template from plugin root
 * @returns Template content string
 * @throws Error if template file cannot be read
 */
export async function readConventionTemplate(
  pluginPath: string,
  templateRelPath: string,
): Promise<string> {
  const templatePath = resolve(join(pluginPath, templateRelPath));
  const resolvedPluginPath = resolve(pluginPath);

  // Prevent path traversal: template must stay within plugin directory
  if (!templatePath.startsWith(resolvedPluginPath + '/') && templatePath !== resolvedPluginPath) {
    throw new Error(
      `Template path escapes plugin directory: ${templateRelPath}`,
    );
  }

  return readFile(templatePath, 'utf-8');
}

// ============================================================
// END-TO-END CONVENTION APPLICATION
// ============================================================

/**
 * Apply all conventions for a plugin to a project.
 * Called from plugin-manager.ts during install/update lifecycle.
 * Resolves conventions from plugin.json automatically.
 *
 * @param pluginPath - Absolute path to plugin source directory (containing plugin.json)
 * @param projectPath - Absolute path to target project
 * @param logger - Optional logger callback
 * @returns Summary of changes made
 */
export async function applyConventions(
  pluginPath: string,
  projectPath: string,
  logger?: ConventionLogger,
): Promise<{
  gitignore: { added: string[]; modified: boolean };
  claudemd: {
    action: 'inserted' | 'updated' | 'unchanged' | 'skipped' | 'error';
    section?: string;
    error?: string;
  };
}> {
  // Resolve conventions from plugin.json
  const conventions = await resolvePluginConventions(pluginPath);

  // Null conventions = no-op
  if (!conventions) {
    return {
      gitignore: { added: [], modified: false },
      claudemd: { action: 'skipped' },
    };
  }

  // Apply gitignore entries
  let gitignoreResult = { added: [] as string[], modified: false };

  if (conventions.gitignore?.project && conventions.gitignore.project.length > 0) {
    const gitignorePath = join(projectPath, '.gitignore');
    gitignoreResult = await ensureGitignoreEntries(
      gitignorePath,
      conventions.gitignore.project,
      '# Managed by magus plugin conventions',
    );

    if (gitignoreResult.modified) {
      logger?.('info', `Added ${gitignoreResult.added.length} entries to .gitignore`);
    }
  }

  // Apply CLAUDE.md section
  let claudemdResult: {
    action: 'inserted' | 'updated' | 'unchanged' | 'skipped' | 'error';
    section?: string;
    error?: string;
  } = { action: 'skipped' };

  if (conventions.claudemd) {
    const claudeMdPath = join(projectPath, 'CLAUDE.md');
    const { section, template, version } = conventions.claudemd;

    try {
      const templateContent = await readConventionTemplate(pluginPath, template);

      const result = await injectClaudeMdSection(claudeMdPath, section, version, templateContent);

      claudemdResult = {
        action: result.action,
        section,
        error: result.error,
      };

      if (result.action === 'inserted') {
        logger?.('info', `Injected CLAUDE.md section "${section}" v${version}`);
      } else if (result.action === 'updated') {
        logger?.('info', `Updated CLAUDE.md section "${section}" from v${result.previousVersion} to v${version}`);
      } else if (result.action === 'error') {
        logger?.('warn', `Could not update CLAUDE.md: ${result.error}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      claudemdResult = { action: 'error', section, error: message };
      logger?.('error', `Failed to apply CLAUDE.md conventions: ${message}`);
    }
  }

  return {
    gitignore: gitignoreResult,
    claudemd: claudemdResult,
  };
}

/**
 * Remove all conventions for a plugin from a project.
 * Called from plugin-manager.ts during uninstall lifecycle.
 * Removes CLAUDE.md section only -- gitignore entries are kept.
 *
 * @param pluginName - Plugin name (used as section identifier)
 * @param projectPath - Absolute path to target project
 * @param logger - Optional logger callback
 * @returns Summary of changes made
 */
export async function removeConventions(
  pluginName: string,
  projectPath: string,
  logger?: ConventionLogger,
): Promise<{
  claudemd: { removed: boolean };
}> {
  // Even without conventions declaration, try to remove the section
  // in case it was applied by a previous version
  const claudeMdPath = join(projectPath, 'CLAUDE.md');

  try {
    const result = await removeClaudeMdSection(claudeMdPath, pluginName);

    if (result.removed) {
      logger?.('info', `Removed CLAUDE.md section "${pluginName}"`);
    }

    return { claudemd: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.('warn', `Failed to remove CLAUDE.md section: ${message}`);
    return { claudemd: { removed: false } };
  }
}
