/**
 * Error Learning Module
 *
 * Simple error tracking - stores errors for Claude to analyze.
 * No clustering, no suggestions - just data collection.
 */

import { getDb, getCurrentSessionId } from './storage';

export interface ErrorInstance {
  id: number;
  sessionId: string;
  timestamp: number;
  rawError: string;
  filePath: string | null;
  category: string | null;
}

/**
 * Extract basic category from error text
 */
function categorizeError(rawError: string): string | null {
  const lower = rawError.toLowerCase();

  if (lower.includes('type') && (lower.includes('assignable') || lower.includes('not assignable'))) {
    return 'typescript-type';
  }
  if (lower.includes('cannot find') || lower.includes('module not found')) {
    return 'import-module';
  }
  if (lower.includes('syntax') || lower.includes('unexpected token')) {
    return 'syntax';
  }
  if (lower.includes('test') || lower.includes('assert') || lower.includes('expect')) {
    return 'test-failure';
  }
  if (lower.includes('lint') || lower.includes('eslint')) {
    return 'lint';
  }
  if (lower.includes('build') || lower.includes('compile')) {
    return 'build';
  }

  return null;
}

/**
 * Extract file path from error text
 */
function extractFilePath(rawError: string): string | null {
  const match = rawError.match(/(?:\/[\w/\-_.]+\.[a-z]+)/i);
  return match ? match[0] : null;
}

/**
 * Log an error instance
 */
export function logError(rawError: string): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();
  const filePath = extractFilePath(rawError);
  const category = categorizeError(rawError);

  const result = db.prepare(`
    INSERT INTO error_instances (session_id, timestamp, raw_error, file_path, category)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, Date.now(), rawError, filePath, category);

  return Number(result.lastInsertRowid);
}

/**
 * Get errors for current session
 */
export function getSessionErrors(limit: number = 20): ErrorInstance[] {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const rows = db.prepare(`
    SELECT id, session_id, timestamp, raw_error, file_path, category
    FROM error_instances
    WHERE session_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(sessionId, limit) as Array<{
    id: number;
    session_id: string;
    timestamp: number;
    raw_error: string;
    file_path: string | null;
    category: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    rawError: row.raw_error,
    filePath: row.file_path,
    category: row.category
  }));
}

/**
 * Get error summary by category for current session
 */
export function getErrorSummary(): Array<{ category: string; count: number }> {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const rows = db.prepare(`
    SELECT
      COALESCE(category, 'unknown') as category,
      COUNT(*) as count
    FROM error_instances
    WHERE session_id = ?
    GROUP BY category
    ORDER BY count DESC
  `).all(sessionId) as Array<{ category: string; count: number }>;

  return rows;
}
