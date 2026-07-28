import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface ExecutionOptions {
  repoPath: string;
  prompt: string;
  model?: string;
  agentCli?: string;
  timeoutMs?: number;
  onLog?: (data: string, fullOutput?: string) => void;
  onFinish?: (exitCode: number | null, outputSummary: string) => void;
}

export function cleanOpencodeOutput(output: string, cliTool: string): string {
  if (!cliTool.includes('opencode') || !output.includes('{"type":')) {
    return output;
  }
  const lines = output.split('\n');
  let textAccumulator = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line.trim());
      if (obj.type === 'text' && obj.part && obj.part.text) {
        textAccumulator += obj.part.text + '\n';
      }
    } catch {
      if (!line.trim().startsWith('{')) {
        textAccumulator += line + '\n';
      }
    }
  }
  return textAccumulator.trim() || output;
}

export class TaskRunner {
  private activeProcesses: Map<string, ChildProcess> = new Map();

  public isRunning(contextId: string): boolean {
    return this.activeProcesses.has(contextId);
  }

  public cancelTask(contextId: string): boolean {
    const proc = this.activeProcesses.get(contextId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(contextId);
      return true;
    }
    return false;
  }

  public executeTask(contextId: string, options: ExecutionOptions): Promise<{ exitCode: number | null; output: string; rawOutput: string }> {
    return new Promise((resolve) => {
      const cliTool = options.agentCli || config.agentCli;
      const model = options.model || config.defaultModel;
      const repoPath = options.repoPath;

      if (!fs.existsSync(repoPath)) {
        const err = `Directory does not exist: ${repoPath}`;
        if (options.onLog) options.onLog(err, err);
        return resolve({ exitCode: 1, output: err, rawOutput: err });
      }

      // Check if CLAUDE.md exists
      const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
      const hasClaudeMd = fs.existsSync(claudeMdPath);

      const systemPrompt = [
        `[SYSTEM INSTRUCTIONS — AUTONOMOUS AGENT MODE]`,
        `You are running as a fully autonomous agent inside a headless CLI. There is NO human at the terminal. stdin is closed.`,
        ``,
        `CRITICAL RULES:`,
        `1. NEVER ask for clarification, confirmation, or user input. You will receive NO response and will hang forever.`,
        `2. NEVER ask "would you like me to..." or "should I..." — just DO IT.`,
        `3. If instructions are ambiguous, use your best judgment and proceed.`,
        `4. If you need to choose between options, pick the most reasonable one and document your choice.`,
        `5. Work with MAX EFFORT — be thorough, comprehensive, and complete. No lazy summaries.`,
        `6. Always commit your changes to a new branch, push, and create a PR when making code changes.`,
        `7. If a CLAUDE.md, AGENTS.md, or .cursorrules file exists in the repo, read and follow its instructions.`,
        `8. After completing your work, provide a clear summary of what you did.`,
        ``,
        `You are working in repository: ${repoPath}`,
      ].join('\n');
      const enhancedPrompt = `${systemPrompt}\n\n${options.prompt}`;

      // Build CLI arguments for opencode / aider / custom runner
      // OpenCode CLI format: opencode run --prompt "<prompt>" --model "<model>"
      let args: string[] = [];
      if (cliTool.includes('opencode')) {
        args = ['run', '--auto', '--format', 'json'];
        if (model) {
          args.push('--model', model);
        }
        args.push(enhancedPrompt);
      } else if (cliTool.includes('aider')) {
        args = ['--message', enhancedPrompt];
        if (model) {
          args.push('--model', model);
        }
      } else {
        // Generic fallback
        args = [enhancedPrompt];
      }

      console.log(`[TaskRunner] Executing: ${cliTool} ${args.join(' ')} in ${repoPath}`);
      if (hasClaudeMd) {
        console.log(`[TaskRunner] Detected CLAUDE.md in target repo.`);
      }

      const proc = spawn(cliTool, args, {
        cwd: repoPath,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.activeProcesses.set(contextId, proc);

      let fullOutput = '';
      let timedOut = false;
      const timeoutMs = options.timeoutMs || 0; // 0 means no timeout
      let timer: NodeJS.Timeout | null = null;
      
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          console.warn(`[TaskRunner] Task ${contextId} timed out after ${timeoutMs / 1000}s. Killing process.`);
          try {
            proc.kill('SIGKILL');
          } catch (e) {
            console.error(`[TaskRunner] Error killing timed out process:`, e);
          }
          this.activeProcesses.delete(contextId);
          const errMsg = `\n[TIMEOUT] Task timed out after ${Math.round(timeoutMs / 60000)} minutes and was terminated.`;
          fullOutput += errMsg;
          if (options.onLog) options.onLog(errMsg, fullOutput);
          resolve({ exitCode: 124, output: cleanOpencodeOutput(fullOutput, cliTool), rawOutput: fullOutput });
        }, timeoutMs);
      }

      proc.stdout?.on('data', (data) => {
        const str = data.toString();
        fullOutput += str;
        if (options.onLog) options.onLog(str, fullOutput);
      });

      proc.stderr?.on('data', (data) => {
        const str = data.toString();
        fullOutput += str;
        if (options.onLog) options.onLog(str, fullOutput);
      });

      proc.on('close', (code) => {
        if (timedOut) return;
        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(contextId);

        const cleanedOutput = cleanOpencodeOutput(fullOutput, cliTool);

        if (options.onFinish) {
          options.onFinish(code, cleanedOutput);
        }
        resolve({ exitCode: code, output: cleanedOutput, rawOutput: fullOutput });
      });

      proc.on('error', (err) => {
        if (timedOut) return;
        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(contextId);
        const errMsg = `Failed to start process '${cliTool}': ${err.message}`;
        fullOutput += `\n${errMsg}`;
        if (options.onLog) options.onLog(errMsg, fullOutput);
        resolve({ exitCode: 1, output: cleanOpencodeOutput(fullOutput, cliTool), rawOutput: fullOutput });
      });
    });
  }

  public runVerification(repoPath: string): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
      let command = '';
      if (fs.existsSync(path.join(repoPath, 'mvnw'))) {
        command = process.platform === 'win32' ? '.\\mvnw.cmd test' : './mvnw test';
      } else if (fs.existsSync(path.join(repoPath, 'package.json'))) {
        command = 'npm test';
      } else if (fs.existsSync(path.join(repoPath, 'requirements.txt')) || fs.existsSync(path.join(repoPath, 'pytest.ini'))) {
        command = 'pytest';
      } else {
        command = 'git status';
      }

      const proc = spawn(command, [], {
        cwd: repoPath,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout?.on('data', (data) => (output += data.toString()));
      proc.stderr?.on('data', (data) => (output += data.toString()));

      proc.on('close', (code) => {
        resolve({ exitCode: code, output });
      });
    });
  }
}

export const taskRunner = new TaskRunner();
