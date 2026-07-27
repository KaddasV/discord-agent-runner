import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface RepoInfo {
  name: string;
  path: string;
  hasClaudeMd: boolean;
  hasGit: boolean;
}

class RepoManager {
  private activeRepoMap: Map<string, string> = new Map(); // channelId/userId -> repoPath

  public discoverRepositories(): RepoInfo[] {
    const repos: RepoInfo[] = [];
    const baseDir = config.reposDir;

    // First add custom repos from config
    for (const [name, repoPath] of Object.entries(config.customRepos)) {
      if (fs.existsSync(repoPath)) {
        repos.push({
          name,
          path: repoPath,
          hasClaudeMd: fs.existsSync(path.join(repoPath, 'CLAUDE.md')),
          hasGit: fs.existsSync(path.join(repoPath, '.git')),
        });
      }
    }

    // Auto-discover top-level subdirectories in baseDir
    if (fs.existsSync(baseDir)) {
      try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'AppData') continue;

          const fullPath = path.join(baseDir, entry.name);
          const hasGit = fs.existsSync(path.join(fullPath, '.git'));
          const hasClaudeMd = fs.existsSync(path.join(fullPath, 'CLAUDE.md'));
          const hasPackageJson = fs.existsSync(path.join(fullPath, 'package.json'));
          const hasPomXml = fs.existsSync(path.join(fullPath, 'pom.xml'));

          // Only add if it looks like a dev project or git repo
          if (hasGit || hasClaudeMd || hasPackageJson || hasPomXml) {
            // Avoid duplicate if already in customRepos
            if (!repos.some((r) => path.resolve(r.path) === path.resolve(fullPath))) {
              repos.push({
                name: entry.name,
                path: fullPath,
                hasClaudeMd,
                hasGit,
              });
            }
          }
        }
      } catch (err) {
        console.error('Error discovering repositories:', err);
      }
    }

    return repos;
  }

  public setActiveRepo(contextId: string, repoPath: string) {
    this.activeRepoMap.set(contextId, repoPath);
  }

  public getActiveRepo(contextId: string): string | null {
    return this.activeRepoMap.get(contextId) || null;
  }
}

export const repoManager = new RepoManager();
