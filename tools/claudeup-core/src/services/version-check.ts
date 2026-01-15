import { executeCommand } from "../utils/command-utils.js";

export interface VersionInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

export interface Logger {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}

export interface VersionCheckOptions {
  packageName: string;
  logger?: Logger;
}

export class VersionChecker {
  private packageName: string;
  private logger?: Logger;

  constructor(options: VersionCheckOptions) {
    this.packageName = options.packageName;
    this.logger = options.logger;
  }

  async getCurrentVersion(): Promise<string | null> {
    try {
      const result = await executeCommand(`npm list -g ${this.packageName} --depth=0 --json`);
      if (!result.success || !result.output) {
        return null;
      }

      const data = JSON.parse(result.output);
      const dependencies = data.dependencies || {};
      const pkg = dependencies[this.packageName];

      return pkg?.version || null;
    } catch (error) {
      this.logger?.error(`Failed to get current version: ${error}`);
      return null;
    }
  }

  async getLatestVersion(): Promise<string | null> {
    try {
      const result = await executeCommand(`npm view ${this.packageName} version`);
      if (!result.success || !result.output) {
        return null;
      }

      return result.output.trim();
    } catch (error) {
      this.logger?.error(`Failed to get latest version: ${error}`);
      return null;
    }
  }

  async checkForUpdates(): Promise<VersionInfo | null> {
    const [current, latest] = await Promise.all([
      this.getCurrentVersion(),
      this.getLatestVersion(),
    ]);

    if (!current || !latest) {
      return null;
    }

    const hasUpdate = this.compareVersions(current, latest) < 0;

    return {
      current,
      latest,
      hasUpdate,
    };
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }

    return 0;
  }

  async performUpdate(): Promise<boolean> {
    try {
      this.logger?.info(`Updating ${this.packageName}...`);
      const result = await executeCommand(`npm install -g ${this.packageName}@latest`);

      if (result.success) {
        this.logger?.info(`Successfully updated ${this.packageName}`);
        return true;
      } else {
        this.logger?.error(`Failed to update: ${result.error}`);
        return false;
      }
    } catch (error) {
      this.logger?.error(`Update failed: ${error}`);
      return false;
    }
  }
}

export function createVersionChecker(options: VersionCheckOptions): VersionChecker {
  return new VersionChecker(options);
}
