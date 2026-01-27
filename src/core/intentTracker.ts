/**
 * Intent Tracker
 *
 * Captures, stores, and verifies user intents.
 * Used by hooks to silently track what the user asked Claude to do.
 */

import { getDb, getCurrentSessionId, getChangedFiles } from './storage';
import * as path from 'path';

// ============================================
// Types
// ============================================

export interface Intent {
  id: string;
  sessionId: string;
  rawPrompt: string;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  completedAt: number | null;
}

// ============================================
// Intent Storage
// ============================================

/**
 * Create a new intent, abandoning any existing active intent
 */
export function createIntent(rawPrompt: string): Intent {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  // Abandon any existing active intent first
  db.prepare(`
    UPDATE intents SET status = 'abandoned'
    WHERE session_id = ? AND status = 'active'
  `).run(sessionId);

  const id = `intent-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO intents (id, session_id, raw_prompt, status, created_at)
    VALUES (?, ?, ?, 'active', ?)
  `).run(id, sessionId, rawPrompt, now);

  return {
    id,
    sessionId,
    rawPrompt,
    status: 'active',
    createdAt: now,
    completedAt: null
  };
}

/**
 * Get the active intent for current session
 */
export function getActiveIntent(): Intent | null {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const row = db.prepare(`
    SELECT id, session_id, raw_prompt, status, created_at, completed_at
    FROM intents
    WHERE session_id = ? AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as {
    id: string;
    session_id: string;
    raw_prompt: string;
    status: string;
    created_at: number;
    completed_at: number | null;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    rawPrompt: row.raw_prompt,
    status: row.status as 'active' | 'completed' | 'abandoned',
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

/**
 * Mark the active intent as completed
 */
export function completeActiveIntent(): void {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  db.prepare(`
    UPDATE intents
    SET status = 'completed', completed_at = ?
    WHERE session_id = ? AND status = 'active'
  `).run(Date.now(), sessionId);
}

/**
 * Check if a new prompt looks like a continuation vs new task
 */
export function isLikelyContinuation(newPrompt: string): boolean {
  const existing = getActiveIntent();
  if (!existing) return false;

  // If existing intent is recent (< 2 min) and new prompt is short,
  // treat as continuation, don't replace
  const age = Date.now() - existing.createdAt;
  if (age < 120000 && newPrompt.length < 100) {
    return true;
  }

  return false;
}

// ============================================
// Intent Verification
// ============================================

/**
 * Generate intent check context for Claude to self-verify
 * Returns null if no active intent
 */
export function generateIntentCheck(): string | null {
  const intent = getActiveIntent();
  if (!intent) return null;

  const changedFiles = getChangedFiles();

  // Group files by directory
  const filesByDir: Record<string, string[]> = {};
  for (const file of changedFiles) {
    const dir = path.dirname(file).split(path.sep).pop() || 'root';
    if (!filesByDir[dir]) filesByDir[dir] = [];
    filesByDir[dir].push(path.basename(file));
  }

  // Format files summary
  const filesSummary = changedFiles.length > 0
    ? changedFiles.map(f => `  - ${f}`).join('\n')
    : '  (no files edited)';

  // Truncate long prompts for display
  const displayPrompt = intent.rawPrompt.length > 200
    ? intent.rawPrompt.slice(0, 200) + '...'
    : intent.rawPrompt;

  return `
## Intent Verification Required

Before stopping, verify your work against the original request.

### Original Request
"${displayPrompt}"

### Work Completed
**Files edited (${changedFiles.length}):**
${filesSummary}

### Your Task
Compare your work to the original request and report:
1. What was requested (break down into items)
2. Status of each item (done, not done, partial)
3. If anything is incomplete, ask if you should continue

Be honest. If you didn't finish something, say so.
`.trim();
}

/**
 * Get intent age in minutes (for display)
 */
export function getIntentAge(): number | null {
  const intent = getActiveIntent();
  if (!intent) return null;

  return Math.round((Date.now() - intent.createdAt) / 60000);
}

/**
 * Format intent for /wink display
 */
export function formatIntentStatus(): string | null {
  const intent = getActiveIntent();
  if (!intent) return null;

  const age = getIntentAge();
  const truncated = intent.rawPrompt.length > 60
    ? intent.rawPrompt.slice(0, 60) + '...'
    : intent.rawPrompt;

  return `active intent (${age}m ago)\n  "${truncated}"`;
}
