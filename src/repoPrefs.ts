import fs from 'fs';
import path from 'path';

/**
 * Persistent per-user repository channel preferences: visibility and permanent removal.
 *
 * "visible" mirrors the /repo dropdown selection (soft show/hide via permission overwrite,
 * channel still exists). "removed" is a hard, persistent block: once a user permanently
 * removes a repo channel (via /removechannel), ensureUserRepoChannels() must never
 * recreate it until the user explicitly restores it from /repo.
 */

const PREFS_FILE = path.join(process.env.TASK_LOG_DIR || './task_logs', 'repo-channel-prefs.json');

interface RepoPref {
  visible: boolean;
  removed: boolean;
  updatedAt: string;
}

interface RepoPrefsMap {
  [userId: string]: {
    [repoPath: string]: RepoPref;
  };
}

let cache: RepoPrefsMap | null = null;

function ensureDir(): void {
  const dir = path.dirname(PREFS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load(): RepoPrefsMap {
  if (cache) return cache;
  try {
    if (fs.existsSync(PREFS_FILE)) {
      cache = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
      return cache!;
    }
  } catch (err) {
    console.warn('[RepoPrefs] Failed to load prefs file, starting fresh:', err);
  }
  cache = {};
  return cache;
}

function save(map: RepoPrefsMap): void {
  ensureDir();
  cache = map;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(map, null, 2), 'utf-8');
  } catch (err) {
    console.error('[RepoPrefs] Failed to save prefs file:', err);
  }
}

const DEFAULT_PREF: RepoPref = { visible: true, removed: false, updatedAt: new Date(0).toISOString() };

function getEntry(userId: string, repoPath: string): RepoPref {
  const map = load();
  return map[userId]?.[repoPath] || DEFAULT_PREF;
}

function setEntry(userId: string, repoPath: string, patch: Partial<Pick<RepoPref, 'visible' | 'removed'>>): void {
  const map = load();
  if (!map[userId]) map[userId] = {};
  const existing = map[userId][repoPath] || DEFAULT_PREF;
  map[userId][repoPath] = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  save(map);
}

/** Whether the repo channel should be shown (permission-visible) for this user. Defaults to true. */
export function isRepoVisible(userId: string, repoPath: string): boolean {
  return getEntry(userId, repoPath).visible;
}

export function setRepoVisible(userId: string, repoPath: string, visible: boolean): void {
  setEntry(userId, repoPath, { visible });
}

/** Whether this user has permanently removed the repo channel. When true, it must never be auto-recreated. */
export function isRepoRemoved(userId: string, repoPath: string): boolean {
  return getEntry(userId, repoPath).removed;
}

/**
 * Mark a repo channel as permanently removed (blocks recreation) or restore it.
 * Restoring also resets visibility to true so the channel reappears once recreated.
 */
export function setRepoRemoved(userId: string, repoPath: string, removed: boolean): void {
  setEntry(userId, repoPath, removed ? { removed: true } : { removed: false, visible: true });
}

/** Repo paths this user has permanently removed. */
export function getRemovedRepoPaths(userId: string): string[] {
  const map = load();
  const userMap = map[userId] || {};
  return Object.entries(userMap)
    .filter(([, pref]) => pref.removed)
    .map(([repoPath]) => repoPath);
}
