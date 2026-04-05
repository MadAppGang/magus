import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export class UpdateCache {
    cachePath;
    constructor() {
        // Cache at ~/.claude/claudeup-cache.json
        this.cachePath = path.join(os.homedir(), ".claude", "claudeup-cache.json");
    }
    async shouldCheckForUpdates() {
        const data = await this.getLastCheck();
        if (!data)
            return true; // No cache
        const lastCheck = new Date(data.lastUpdateCheck);
        const now = new Date();
        const elapsed = now.getTime() - lastCheck.getTime();
        return elapsed >= CACHE_TTL_MS;
    }
    async getLastCheck() {
        try {
            const content = await fs.readFile(this.cachePath, "utf-8");
            const data = JSON.parse(content);
            return data;
        }
        catch (error) {
            // Cache doesn't exist or is corrupted
            return null;
        }
    }
    async saveCheck(result) {
        try {
            // Ensure .claude directory exists
            const cacheDir = path.dirname(this.cachePath);
            await fs.mkdir(cacheDir, { recursive: true });
            // Write cache file
            await fs.writeFile(this.cachePath, JSON.stringify(result, null, 2), "utf-8");
        }
        catch (error) {
            // Non-fatal - just log and continue
            console.warn("Warning: Failed to save update cache:", error instanceof Error ? error.message : "Unknown error");
        }
    }
    async clear() {
        try {
            await fs.unlink(this.cachePath);
        }
        catch (error) {
            // Ignore errors (file might not exist)
        }
    }
}
