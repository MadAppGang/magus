import { readFile } from "fs/promises";
import { join } from "path";
import { parseJsonSafe } from "../utils/string-utils.js";

export interface PluginMcpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface PluginManifest {
  name: string;
  version: string;
  mcpServers?: Record<string, PluginMcpServer>;
}

export interface PluginMcpConfigOptions {
  pluginPath: string;
}

export class PluginMcpConfig {
  private pluginPath: string;

  constructor(options: PluginMcpConfigOptions) {
    this.pluginPath = options.pluginPath;
  }

  async readManifest(): Promise<PluginManifest | null> {
    try {
      const manifestPath = join(this.pluginPath, "plugin.json");
      const content = await readFile(manifestPath, "utf-8");
      return parseJsonSafe<PluginManifest>(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async getMcpServers(): Promise<Record<string, PluginMcpServer>> {
    const manifest = await this.readManifest();
    return manifest?.mcpServers || {};
  }

  async hasMcpServers(): Promise<boolean> {
    const servers = await this.getMcpServers();
    return Object.keys(servers).length > 0;
  }

  resolveServerPaths(server: PluginMcpServer): PluginMcpServer {
    const resolved = { ...server };

    if (resolved.command.includes("${PLUGIN_ROOT}")) {
      resolved.command = resolved.command.replace(/\$\{PLUGIN_ROOT\}/g, this.pluginPath);
    }

    if (resolved.args) {
      resolved.args = resolved.args.map((arg) =>
        arg.replace(/\$\{PLUGIN_ROOT\}/g, this.pluginPath)
      );
    }

    return resolved;
  }

  async getResolvedMcpServers(): Promise<Record<string, PluginMcpServer>> {
    const servers = await this.getMcpServers();
    const resolved: Record<string, PluginMcpServer> = {};

    for (const [name, server] of Object.entries(servers)) {
      resolved[name] = this.resolveServerPaths(server);
    }

    return resolved;
  }
}

export function createPluginMcpConfig(options: PluginMcpConfigOptions): PluginMcpConfig {
  return new PluginMcpConfig(options);
}
