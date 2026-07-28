import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface ExecutionOptions {
  repoPath: string;
  prompt: string;
  model?: string;
  agentCli?: string;
  onLog?: (data: string) => void;
  onFinish?: (exitCode: number | null, outputSummary: string) => void;
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
        if (options.onLog) options.onLog(err);
        return resolve({ exitCode: 1, output: err, rawOutput: err });
      }

      // Check if CLAUDE.md exists
      const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
      const hasClaudeMd = fs.existsSync(claudeMdPath);

      const maxEffortHeader = `[SYSTEM INSTRUCTION: Work with MAX EFFORT, maximum reasoning thoroughness, and comprehensive analysis. Do not give short, lazy, or incomplete summaries. Execute instructions carefully and completely.]\n\n`;
      const enhancedPrompt = `${maxEffortHeader}${options.prompt}`;

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
        shell: true,
        env: { ...process.env },
      });

      this.activeProcesses.set(contextId, proc);

      let fullOutput = '';

      proc.stdout?.on('data', (data) => {
        const str = data.toString();
        fullOutput += str;
        if (options.onLog) options.onLog(str);
      });

      proc.stderr?.on('data', (data) => {
        const str = data.toString();
        fullOutput += str;
        if (options.onLog) options.onLog(str);
      });

      proc.on('close', (code) => {
        this.activeProcesses.delete(contextId);

        // Extract clean text if json lines were received
        let cleanedOutput = fullOutput;
        if (cliTool.includes('opencode') && fullOutput.includes('{"type":')) {
          const lines = fullOutput.split('\n');
          let textAccumulator = '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line.trim());
              if (obj.type === 'text' && obj.part && obj.part.text) {
                textAccumulator += obj.part.text + '\n';
              }
            } catch {
              // Ignore non-json lines
            }
          }
          if (textAccumulator.trim()) {
            cleanedOutput = textAccumulator.trim();
          }
        }

        if (options.onFinish) {
          options.onFinish(code, cleanedOutput);
        }
        resolve({ exitCode: code, output: cleanedOutput, rawOutput: fullOutput });
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(contextId);
        const errMsg = `Failed to start process '${cliTool}': ${err.message}`;
        fullOutput += `\n${errMsg}`;
        if (options.onLog) options.onLog(errMsg);
        resolve({ exitCode: 1, output: fullOutput, rawOutput: fullOutput });
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
