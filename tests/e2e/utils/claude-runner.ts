/**
 * Claude Code CLI runner for E2E tests
 * Executes prompts against Claude Code and captures responses
 */

import { spawn, type Subprocess } from "bun";

export interface ClaudeRunResult {
  prompt: string;
  response: string;
  stderr: string;
  exitCode: number | null;
  duration: number; // milliseconds
  error?: string;
}

export class ClaudeRunner {
  private claudePath: string;
  private timeout: number;

  constructor(claudePath?: string, timeout: number = 120000) {
    // Default to globally installed claude
    this.claudePath = claudePath || "claude";
    this.timeout = timeout;
  }

  /**
   * Execute a prompt against Claude Code and capture response
   */
  async run(
    prompt: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<ClaudeRunResult> {
    const startTime = Date.now();
    const timeout = options?.timeout || this.timeout;

    try {
      // Spawn Claude Code process with --print for direct output
      const proc = spawn({
        cmd: [
          this.claudePath,
          "--print", // Output response directly
          "--dangerously-skip-permissions", // Skip permission prompts for testing
          "-p",
          prompt,
        ],
        cwd: options?.cwd || process.cwd(),
        env: { ...process.env, ...options?.env },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Collect output with timeout
      const result = await this.collectOutput(proc, timeout);
      const duration = Date.now() - startTime;

      return {
        prompt,
        response: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
      };
    } catch (error) {
      return {
        prompt,
        response: "",
        stderr: "",
        exitCode: null,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Collect stdout/stderr with timeout
   */
  private async collectOutput(
    proc: Subprocess,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Timeout after ${timeout}ms`));
      }, timeout);
    });

    const outputPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    })();

    return Promise.race([outputPromise, timeoutPromise]);
  }

  /**
   * Run multiple prompts in parallel (with concurrency limit)
   */
  async runBatch(
    prompts: string[],
    options?: { maxConcurrency?: number }
  ): Promise<ClaudeRunResult[]> {
    const maxConcurrency = options?.maxConcurrency || 2; // Lower default for Claude
    const results: ClaudeRunResult[] = [];

    for (let i = 0; i < prompts.length; i += maxConcurrency) {
      const batch = prompts.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((prompt) => this.run(prompt))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Check if Claude CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const proc = spawn({
        cmd: [this.claudePath, "--version"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }
}
