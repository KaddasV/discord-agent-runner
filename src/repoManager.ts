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
  private repoCache: { timestamp: number; repos: RepoInfo[] } | null = null;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds TTL

  public discoverRepositories(forceRefresh = false): RepoInfo[] {
    const now = Date.now();
    if (!forceRefresh && this.repoCache && now - this.repoCache.timestamp < this.CACHE_TTL_MS) {
      return this.repoCache.repos;
    }

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
          const ignoredDirs = [
            'node_modules', 'AppData', 'Application Data', 'Contacts', 'Cookies',
            'Desktop', 'Documents', 'Downloads', 'Favorites', 'Links', 'Local Settings',
            'Music', 'My Documents', 'NetHood', 'OneDrive', 'Pictures', 'PrintHood',
            'Recent', 'Saved Games', 'Searches', 'SendTo', 'Start Menu', 'Templates',
            'Tracing', 'Videos', 'Intel'
          ];
          if (entry.name.startsWith('.') || ignoredDirs.includes(entry.name)) continue;

          const fullPath = path.join(baseDir, entry.name);
          const hasGit = fs.existsSync(path.join(fullPath, '.git'));
          const hasClaudeMd = fs.existsSync(path.join(fullPath, 'CLAUDE.md'));

          if (!repos.some((r) => path.resolve(r.path) === path.resolve(fullPath))) {
            repos.push({
              name: entry.name,
              path: fullPath,
              hasClaudeMd,
              hasGit,
            });
          }
        }
      } catch (err) {
        console.error('Error discovering repositories:', err);
      }
    }

    this.repoCache = { timestamp: Date.now(), repos };
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
