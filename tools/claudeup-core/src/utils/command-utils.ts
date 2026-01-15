import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function executeCommand(command: string): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execAsync(command);
    return {
      success: true,
      output: stdout.trim(),
      error: stderr ? stderr.trim() : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkCommandExists(command: string): Promise<boolean> {
  const checkCmd = process.platform === "win32" ? `where ${command}` : `which ${command}`;
  const result = await executeCommand(checkCmd);
  return result.success;
}

export async function getCommandVersion(command: string, versionFlag = "--version"): Promise<string | null> {
  const result = await executeCommand(`${command} ${versionFlag}`);
  if (result.success && result.output) {
    return result.output.split("\n")[0];
  }
  return null;
}
