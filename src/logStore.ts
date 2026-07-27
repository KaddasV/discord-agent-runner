import fs from 'fs';
import path from 'path';

export interface TaskLogMetadata {
  requestId: string;
  prompt: string;
  model: string;
  repo: string;
  exitCode: number | null;
  output: string;
  timestamp: string;
}

const LOGS_DIR = path.join(process.cwd(), 'task_logs');

// Ensure directory exists on startup
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
} catch (err) {
  console.error('[LogStore] Failed to create task_logs directory:', err);
}

const memoryStore: Map<string, TaskLogMetadata> = new Map();

export function saveTaskLog(metadata: TaskLogMetadata): void {
  const { requestId } = metadata;
  const upperId = requestId.toUpperCase();
  memoryStore.set(upperId, metadata);

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    const jsonPath = path.join(LOGS_DIR, `${upperId}.json`);
    const logPath = path.join(LOGS_DIR, `${upperId}.log`);

    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
    fs.writeFileSync(logPath, metadata.output || '(No output log recorded)', 'utf-8');
    console.log(`[LogStore] Saved logs for ${upperId} to disk.`);
  } catch (err) {
    console.error(`[LogStore] Error writing log files for ${upperId}:`, err);
  }
}

export function getTaskLog(idInput: string): TaskLogMetadata | null {
  const cleanId = idInput.trim().toUpperCase();
  let candidates = [cleanId];
  if (!cleanId.startsWith('REQ-')) {
    candidates.push(`REQ-${cleanId}`);
  }

  for (const candidate of candidates) {
    if (memoryStore.has(candidate)) {
      return memoryStore.get(candidate)!;
    }
  }

  // Fallback to disk search
  try {
    if (!fs.existsSync(LOGS_DIR)) return null;
    const files = fs.readdirSync(LOGS_DIR);
    
    // Look for matching .json file
    for (const file of files) {
      if (file.endsWith('.json')) {
        const base = file.replace('.json', '').toUpperCase();
        for (const candidate of candidates) {
          if (base === candidate || base.includes(cleanId)) {
            const content = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
            const parsed: TaskLogMetadata = JSON.parse(content);
            memoryStore.set(parsed.requestId.toUpperCase(), parsed);
            return parsed;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[LogStore] Error reading logs from disk for ${cleanId}:`, err);
  }

  return null;
}
