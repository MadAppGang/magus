/**
 * Parser utilities for testing plugin components
 *
 * Provides parsing functions for YAML frontmatter, plugin manifests,
 * hooks config, and MCP server configurations.
 */

/**
 * Parse YAML frontmatter from a markdown file
 *
 * Extracts content between --- delimiters at the start of a file
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const [, yamlContent, body] = match;

  // Simple YAML parser for frontmatter (handles key: value, arrays, and multi-line strings)
  const frontmatter: Record<string, unknown> = {};

  const lines = yamlContent.split('\n');
  let currentKey = '';
  let currentValue: string[] = [];
  let inMultiline = false;
  let inArray = false;
  let arrayValues: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Check for array item
    if (inArray && trimmed.startsWith('- ')) {
      arrayValues.push(trimmed.slice(2).trim());
      continue;
    }

    // Check for key: value or key:
    const keyMatch = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (keyMatch) {
      // Save previous key if any
      if (currentKey) {
        if (inArray) {
          frontmatter[currentKey] = arrayValues;
        } else if (inMultiline) {
          frontmatter[currentKey] = currentValue.join('\n').trim();
        }
      }

      const [, key, value] = keyMatch;
      currentKey = key;

      if (value === '') {
        // Could be start of array or multiline
        inArray = true;
        inMultiline = false;
        arrayValues = [];
        currentValue = [];
      } else if (value.startsWith('"') && value.endsWith('"')) {
        // Quoted string
        frontmatter[currentKey] = value.slice(1, -1);
        currentKey = '';
        inArray = false;
        inMultiline = false;
      } else if (value.startsWith("'") && value.endsWith("'")) {
        // Single-quoted string
        frontmatter[currentKey] = value.slice(1, -1);
        currentKey = '';
        inArray = false;
        inMultiline = false;
      } else if (value === 'true' || value === 'false') {
        frontmatter[currentKey] = value === 'true';
        currentKey = '';
        inArray = false;
        inMultiline = false;
      } else if (!isNaN(Number(value)) && value !== '') {
        frontmatter[currentKey] = Number(value);
        currentKey = '';
        inArray = false;
        inMultiline = false;
      } else {
        // Plain string value
        frontmatter[currentKey] = value;
        currentKey = '';
        inArray = false;
        inMultiline = false;
      }
    } else if (inArray && trimmed.startsWith('-')) {
      arrayValues.push(trimmed.slice(1).trim());
    }
  }

  // Save last key
  if (currentKey) {
    if (inArray) {
      frontmatter[currentKey] = arrayValues;
    } else if (inMultiline) {
      frontmatter[currentKey] = currentValue.join('\n').trim();
    }
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Validate agent frontmatter structure
 */
export interface AgentFrontmatter {
  name: string;
  description: string;
  color?: string;
  tools?: string;
  model?: string;
}

export function validateAgentFrontmatter(
  frontmatter: Record<string, unknown>,
): { valid: true; data: AgentFrontmatter } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof frontmatter.name !== 'string' || !frontmatter.name) {
    errors.push('Agent must have a "name" field');
  }

  if (typeof frontmatter.description !== 'string' || !frontmatter.description) {
    errors.push('Agent must have a "description" field');
  }

  if (frontmatter.color !== undefined && typeof frontmatter.color !== 'string') {
    errors.push('Agent "color" must be a string if provided');
  }

  if (frontmatter.tools !== undefined && typeof frontmatter.tools !== 'string') {
    errors.push('Agent "tools" must be a comma-separated string if provided');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name: frontmatter.name as string,
      description: frontmatter.description as string,
      color: frontmatter.color as string | undefined,
      tools: frontmatter.tools as string | undefined,
      model: frontmatter.model as string | undefined,
    },
  };
}

/**
 * Validate command frontmatter structure
 */
export interface CommandFrontmatter {
  description: string;
  'allowed-tools'?: string;
}

export function validateCommandFrontmatter(
  frontmatter: Record<string, unknown>,
): { valid: true; data: CommandFrontmatter } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof frontmatter.description !== 'string' || !frontmatter.description) {
    errors.push('Command must have a "description" field');
  }

  if (frontmatter['allowed-tools'] !== undefined && typeof frontmatter['allowed-tools'] !== 'string') {
    errors.push('Command "allowed-tools" must be a comma-separated string if provided');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      description: frontmatter.description as string,
      'allowed-tools': frontmatter['allowed-tools'] as string | undefined,
    },
  };
}

/**
 * Validate skill frontmatter structure
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  'allowed-tools'?: string;
  prerequisites?: string[];
  dependencies?: string[];
}

export function validateSkillFrontmatter(
  frontmatter: Record<string, unknown>,
): { valid: true; data: SkillFrontmatter } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof frontmatter.name !== 'string' || !frontmatter.name) {
    errors.push('Skill must have a "name" field');
  }

  if (typeof frontmatter.description !== 'string' || !frontmatter.description) {
    errors.push('Skill must have a "description" field');
  }

  if (frontmatter['allowed-tools'] !== undefined && typeof frontmatter['allowed-tools'] !== 'string') {
    errors.push('Skill "allowed-tools" must be a comma-separated string if provided');
  }

  if (frontmatter.prerequisites !== undefined && !Array.isArray(frontmatter.prerequisites)) {
    errors.push('Skill "prerequisites" must be an array if provided');
  }

  if (frontmatter.dependencies !== undefined && !Array.isArray(frontmatter.dependencies)) {
    errors.push('Skill "dependencies" must be an array if provided');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name: frontmatter.name as string,
      description: frontmatter.description as string,
      'allowed-tools': frontmatter['allowed-tools'] as string | undefined,
      prerequisites: frontmatter.prerequisites as string[] | undefined,
      dependencies: frontmatter.dependencies as string[] | undefined,
    },
  };
}

/**
 * Validate plugin.json manifest structure
 */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: {
    name: string;
    email?: string;
    company?: string;
  };
  license?: string;
  keywords?: string[];
  category?: string;
  agents?: string[];
  commands?: string[];
  skills?: string[];
  hooks?: string;
  mcpServers?: string;
}

export function validatePluginManifest(
  manifest: unknown,
): { valid: true; data: PluginManifest } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Plugin manifest must be an object'] };
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.name !== 'string' || !m.name) {
    errors.push('Plugin must have a "name" field');
  }

  if (typeof m.version !== 'string' || !m.version) {
    errors.push('Plugin must have a "version" field');
  } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version as string)) {
    errors.push('Plugin version must follow semver format (X.Y.Z)');
  }

  if (typeof m.description !== 'string' || !m.description) {
    errors.push('Plugin must have a "description" field');
  }

  if (m.author !== undefined) {
    if (typeof m.author !== 'object' || !m.author) {
      errors.push('Plugin "author" must be an object if provided');
    } else {
      const author = m.author as Record<string, unknown>;
      if (typeof author.name !== 'string') {
        errors.push('Plugin author must have a "name" field');
      }
    }
  }

  if (m.keywords !== undefined && !Array.isArray(m.keywords)) {
    errors.push('Plugin "keywords" must be an array if provided');
  }

  if (m.agents !== undefined && !Array.isArray(m.agents)) {
    errors.push('Plugin "agents" must be an array if provided');
  }

  if (m.commands !== undefined && !Array.isArray(m.commands)) {
    errors.push('Plugin "commands" must be an array if provided');
  }

  if (m.skills !== undefined && !Array.isArray(m.skills)) {
    errors.push('Plugin "skills" must be an array if provided');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: m as unknown as PluginManifest,
  };
}

/**
 * Validate hooks.json structure
 */
export interface HooksConfig {
  description?: string;
  hooks: {
    SessionStart?: HookEntry[];
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    Notification?: HookEntry[];
    Stop?: HookEntry[];
  };
}

export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}

export function validateHooksConfig(
  config: unknown,
): { valid: true; data: HooksConfig } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Hooks config must be an object'] };
  }

  const c = config as Record<string, unknown>;

  if (!c.hooks || typeof c.hooks !== 'object') {
    errors.push('Hooks config must have a "hooks" object');
    return { valid: false, errors };
  }

  const hooks = c.hooks as Record<string, unknown>;
  const validEvents = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'];

  for (const eventName of Object.keys(hooks)) {
    if (!validEvents.includes(eventName)) {
      errors.push(`Unknown hook event: "${eventName}". Valid events: ${validEvents.join(', ')}`);
      continue;
    }

    const eventHooks = hooks[eventName];
    if (!Array.isArray(eventHooks)) {
      errors.push(`Hook event "${eventName}" must be an array`);
      continue;
    }

    for (let i = 0; i < eventHooks.length; i++) {
      const entry = eventHooks[i];
      if (!entry || typeof entry !== 'object') {
        errors.push(`Hook entry ${i} in "${eventName}" must be an object`);
        continue;
      }

      const e = entry as Record<string, unknown>;

      if (!Array.isArray(e.hooks)) {
        errors.push(`Hook entry ${i} in "${eventName}" must have a "hooks" array`);
        continue;
      }

      for (let j = 0; j < e.hooks.length; j++) {
        const hook = e.hooks[j] as Record<string, unknown>;
        if (hook.type !== 'command') {
          errors.push(`Hook ${j} in entry ${i} of "${eventName}" must have type "command"`);
        }
        if (typeof hook.command !== 'string') {
          errors.push(`Hook ${j} in entry ${i} of "${eventName}" must have a "command" string`);
        }
        if (hook.timeout !== undefined && typeof hook.timeout !== 'number') {
          errors.push(`Hook ${j} in entry ${i} of "${eventName}" timeout must be a number`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: c as unknown as HooksConfig,
  };
}

/**
 * Validate MCP server configuration
 */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export function validateMcpConfig(
  config: unknown,
): { valid: true; data: Record<string, McpServerConfig> } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: ['MCP config must be an object'] };
  }

  const c = config as Record<string, unknown>;

  for (const [serverName, serverConfig] of Object.entries(c)) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      errors.push(`MCP server "${serverName}" must be an object`);
      continue;
    }

    const sc = serverConfig as Record<string, unknown>;

    // Must have either command or url
    if (sc.command === undefined && sc.url === undefined) {
      errors.push(`MCP server "${serverName}" must have either "command" or "url"`);
    }

    if (sc.command !== undefined && typeof sc.command !== 'string') {
      errors.push(`MCP server "${serverName}" command must be a string`);
    }

    if (sc.args !== undefined && !Array.isArray(sc.args)) {
      errors.push(`MCP server "${serverName}" args must be an array`);
    }

    if (sc.env !== undefined) {
      if (typeof sc.env !== 'object' || sc.env === null || Array.isArray(sc.env)) {
        errors.push(`MCP server "${serverName}" env must be an object`);
      } else {
        for (const [key, value] of Object.entries(sc.env)) {
          if (typeof value !== 'string') {
            errors.push(`MCP server "${serverName}" env value for "${key}" must be a string`);
          }
        }
      }
    }

    if (sc.url !== undefined && typeof sc.url !== 'string') {
      errors.push(`MCP server "${serverName}" url must be a string`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: c as Record<string, McpServerConfig>,
  };
}
