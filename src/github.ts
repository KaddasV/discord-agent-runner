import { spawn } from 'child_process';

export interface GhIssue {
  number: number;
  title: string;
  url: string;
  body: string;
  labels: { name: string }[];
  createdAt: string;
}

export interface ListIssuesResult {
  success: boolean;
  issues: GhIssue[];
  error?: string;
}

export function listOpenIssues(repoPath: string, opts: { labels?: string; limit?: number } = {}): Promise<ListIssuesResult> {
  return new Promise((resolve) => {
    const limit = Math.min(Math.max(opts.limit || 10, 1), 25);
    const args = [
      'issue',
      'list',
      '--state', 'open',
      '--json', 'number,title,url,body,labels,createdAt',
      '--limit', String(limit),
    ];
    if (opts.labels) {
      args.push('--label', opts.labels);
    }

    const proc = spawn('gh', args, {
      cwd: repoPath,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => (stdout += data.toString()));
    proc.stderr?.on('data', (data) => (stderr += data.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, issues: [], error: stderr.trim() || `gh issue list exited with code ${code}` });
        return;
      }
      try {
        const issues: GhIssue[] = JSON.parse(stdout.trim() || '[]');
        resolve({ success: true, issues });
      } catch (err: any) {
        resolve({ success: false, issues: [], error: `Failed to parse gh output: ${err.message || err}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, issues: [], error: `Failed to start 'gh' CLI: ${err.message || err}` });
    });
  });
}
