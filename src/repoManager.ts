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

  public getRepoFromChannel(channel: any): string | null {
    if (!channel) return null;
    const repos = this.discoverRepositories();

    if (channel.topic && typeof channel.topic === 'string') {
      const match = channel.topic.match(/Path:\s*([^\s|]+)/i) || channel.topic.match(/Repository:\s*([^\s|]+)/i);
      if (match && match[1]) {
        const val = match[1].trim();
        const found = repos.find(r => r.path === val || r.name === val || r.name.toLowerCase() === val.toLowerCase());
        if (found) return found.path;
      }
    }

    if (channel.name && typeof channel.name === 'string') {
      if (channel.name.startsWith('repo-')) {
        const cleanChName = channel.name.replace(/^repo-/, '');
        for (const r of repos) {
          const cleanRepoName = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanChName.startsWith(cleanRepoName) || cleanChName.includes(cleanRepoName)) {
            return r.path;
          }
        }
      }
    }

    return null;
  }
}

export const repoManager = new RepoManager();
