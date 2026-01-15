import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseJsonSafe } from "../utils/string-utils.js";

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClaudeConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface Logger {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  success: (message: string) => void;
}

export interface McpRegistryOptions {
  configPath: string;
  logger?: Logger;
}

export class McpRegistry {
  private configPath: string;
  private logger?: Logger;

  constructor(options: McpRegistryOptions) {
    this.configPath = options.configPath;
    this.logger = options.logger;
  }

  async readConfig(): Promise<ClaudeConfig> {
    try {
      const content = await readFile(this.configPath, "utf-8");
      const config = parseJsonSafe<ClaudeConfig>(content);
      return config || {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      this.logger?.error(`Failed to read config: ${error}`);
      throw error;
    }
  }

  async writeConfig(config: ClaudeConfig): Promise<void> {
    try {
      const content = JSON.stringify(config, null, 2);
      await writeFile(this.configPath, content, "utf-8");
      this.logger?.success("Config updated successfully");
    } catch (error) {
      this.logger?.error(`Failed to write config: ${error}`);
      throw error;
    }
  }

  async addServer(name: string, server: McpServerConfig): Promise<void> {
    const config = await this.readConfig();

    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    if (config.mcpServers[name]) {
      this.logger?.warn(`MCP server "${name}" already exists. Overwriting.`);
    }

    config.mcpServers[name] = server;
    await this.writeConfig(config);
    this.logger?.success(`Added MCP server: ${name}`);
  }

  async removeServer(name: string): Promise<boolean> {
    const config = await this.readConfig();

    if (!config.mcpServers || !config.mcpServers[name]) {
      this.logger?.warn(`MCP server "${name}" not found`);
      return false;
    }

    delete config.mcpServers[name];
    await this.writeConfig(config);
    this.logger?.success(`Removed MCP server: ${name}`);
    return true;
  }

  async listServers(): Promise<Record<string, McpServerConfig>> {
    const config = await this.readConfig();
    return config.mcpServers || {};
  }

  async getServer(name: string): Promise<McpServerConfig | null> {
    const servers = await this.listServers();
    return servers[name] || null;
  }

  async hasServer(name: string): Promise<boolean> {
    const servers = await this.listServers();
    return name in servers;
  }
}

export function createMcpRegistry(options: McpRegistryOptions): McpRegistry {
  return new McpRegistry(options);
}
