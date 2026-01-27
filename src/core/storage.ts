import { Database } from "bun:sqlite";
import * as path from 'path';
import * as fs from 'fs';

let db: Database | null = null;

// Current schema version - increment when adding migrations
const CURRENT_SCHEMA_VERSION = 4;

function getDbPath(): string {
  const cwd = process.cwd();
  const dbDir = path.join(cwd, '.wink');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  return path.join(dbDir, 'session.db');
}

export function getDb(): Database {
  if (!db) {
    const dbPath = getDbPath();

    db = new Database(dbPath);

    // Enable WAL mode for concurrent access
    db.exec('PRAGMA journal_mode = WAL');

    // Wait up to 5 seconds if database is locked
    db.exec('PRAGMA busy_timeout = 5000');

    // Initialize schema and run migrations
    initSchema(db);
    runMigrations(db);
  }

  return db;
}

/**
 * Run database migrations for existing users
 * Each migration is idempotent - safe to run multiple times
 */
function runMigrations(db: Database): void {
  // Create schema_version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  // Get current version
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null };
  const currentVersion = row?.version ?? 0;

  // Migration 1: Add error_instances table with category column (v1 -> v2)
  if (currentVersion < 2) {
    try {
      // Check if error_instances table exists
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='error_instances'
      `).get();

      if (tableExists) {
        // Table exists - check if category column exists
        const columns = db.prepare('PRAGMA table_info(error_instances)').all() as Array<{ name: string }>;
        const hasCategory = columns.some(c => c.name === 'category');

        if (!hasCategory) {
          // Add the missing category column
          db.exec('ALTER TABLE error_instances ADD COLUMN category TEXT');
        }

        // Check if file_path column exists (older versions might not have it)
        const hasFilePath = columns.some(c => c.name === 'file_path');
        if (!hasFilePath) {
          db.exec('ALTER TABLE error_instances ADD COLUMN file_path TEXT');
        }
      }
      // If table doesn't exist, initSchema will create it with all columns

      // Record migration
      db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(CURRENT_SCHEMA_VERSION, Date.now());
    } catch (err) {
      // Log but don't fail - migrations should be resilient
      if (process.env.WINK_DEBUG) {
        console.error('Migration error:', err);
      }
    }
  }

  // Migration 2: Add Intent Guardian table (v2 -> v3)
  if (currentVersion < 3) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS intents (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          raw_prompt TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_intents_session ON intents(session_id);
        CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
      `);

      // Record migration
      db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(3, Date.now());
    } catch (err) {
      if (process.env.WINK_DEBUG) {
        console.error('Migration v3 error:', err);
      }
    }
  }

  // Migration 3: Add verification baseline table (v3 -> v4)
  if (currentVersion < 4) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS verification_baseline (
          session_id TEXT NOT NULL,
          check_name TEXT NOT NULL,
          passed INTEGER NOT NULL,
          captured_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, check_name)
        );

        CREATE INDEX IF NOT EXISTS idx_baseline_session ON verification_baseline(session_id);
      `);

      // Record migration
      db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(4, Date.now());
    } catch (err) {
      if (process.env.WINK_DEBUG) {
        console.error('Migration v4 error:', err);
      }
    }
  }
}

function initSchema(db: Database): void {
  db.exec(`
    -- Core session tracking
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER,
      mode TEXT DEFAULT 'warn',
      current INTEGER DEFAULT 1
    );

    -- Event logging (reads, edits, searches, etc.)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      tool TEXT NOT NULL,
      action TEXT,
      input_json TEXT,
      output_summary TEXT,
      success INTEGER,
      duration_ms INTEGER
    );

    -- Evidence tracking for file operations
    CREATE TABLE IF NOT EXISTS evidence (
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      detail_json TEXT,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_id, file_path, evidence_type)
    );

    -- Verification results
    CREATE TABLE IF NOT EXISTS verify_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      mode TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      all_passing INTEGER NOT NULL,
      duration_ms INTEGER
    );

    -- Daily metrics
    CREATE TABLE IF NOT EXISTS wink_metrics (
      date TEXT PRIMARY KEY,
      stop_blocks INTEGER DEFAULT 0,
      stop_allows INTEGER DEFAULT 0,
      edit_blocks INTEGER DEFAULT 0,
      edit_warns INTEGER DEFAULT 0,
      verify_runs INTEGER DEFAULT 0,
      false_positives INTEGER DEFAULT 0,
      rage_quits INTEGER DEFAULT 0,
      loop_detections INTEGER DEFAULT 0,
      session_saves INTEGER DEFAULT 0
    );

    -- Decision audit log
    CREATE TABLE IF NOT EXISTS decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      user_override INTEGER DEFAULT 0,
      was_correct INTEGER
    );

    -- Quality check events
    CREATE TABLE IF NOT EXISTS quality_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      check_name TEXT NOT NULL,
      passed INTEGER NOT NULL,
      output_summary TEXT,
      changed_files_json TEXT NOT NULL,
      is_regression INTEGER DEFAULT 0
    );

    -- Simple error tracking (for Claude to analyze)
    CREATE TABLE IF NOT EXISTS error_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      raw_error TEXT NOT NULL,
      file_path TEXT,
      category TEXT
    );

    -- Intent Guardian: tracks user intents for completion verification
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      raw_prompt TEXT NOT NULL,
      status TEXT DEFAULT 'active',  -- 'active', 'completed', 'abandoned'
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_events_session
      ON events(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_evidence_session
      ON evidence(session_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_file
      ON evidence(session_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_verify_session
      ON verify_results(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_decision_session
      ON decision_log(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_quality_session
      ON quality_events(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_error_instances_session
      ON error_instances(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_intents_session
      ON intents(session_id);
    CREATE INDEX IF NOT EXISTS idx_intents_status
      ON intents(status);

    -- Verification baseline: captures initial state of checks per session
    CREATE TABLE IF NOT EXISTS verification_baseline (
      session_id TEXT NOT NULL,
      check_name TEXT NOT NULL,
      passed INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, check_name)
    );

    CREATE INDEX IF NOT EXISTS idx_baseline_session
      ON verification_baseline(session_id);
  `);
}

export interface Event {
  tool: string;
  action?: string;
  input: any;
  output_summary?: string;
  success: boolean;
  duration_ms?: number;
  timestamp: number;
}

export function getCurrentSessionId(): string {
  const db = getDb();
  const row = db.prepare('SELECT id FROM sessions WHERE current = 1').get() as { id: string } | undefined;

  if (row) {
    return row.id;
  }

  // Create new session
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  db.prepare('INSERT INTO sessions (id, started_at, current) VALUES (?, ?, 1)').run(sessionId, Date.now());

  return sessionId;
}

export function startNewSession(): string {
  const db = getDb();

  // Mark all existing sessions as not current
  db.prepare('UPDATE sessions SET current = 0').run();

  // Create new session
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  db.prepare('INSERT INTO sessions (id, started_at, current) VALUES (?, ?, 1)').run(sessionId, Date.now());

  return sessionId;
}

/**
 * Get list of files changed (edited/written) in current session
 */
export function getChangedFiles(): string[] {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const rows = db.prepare(`
    SELECT DISTINCT json_extract(input_json, '$.file_path') as file_path
    FROM events
    WHERE session_id = ?
      AND tool IN ('Edit', 'Write', 'MultiEdit')
      AND json_extract(input_json, '$.file_path') IS NOT NULL
  `).all(sessionId) as Array<{ file_path: string }>;

  return rows.map(r => r.file_path).filter(Boolean);
}

export function logEvent(event: Event) {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const stmt = db.prepare(`
    INSERT INTO events (session_id, timestamp, tool, action, input_json, output_summary, success, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    sessionId,
    event.timestamp,
    event.tool,
    event.action || null,
    JSON.stringify(event.input),
    event.output_summary || null,
    event.success ? 1 : 0,
    event.duration_ms || null
  );
}

export function updateEvidence(filePath: string, type: string, detail: any) {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO evidence (session_id, file_path, evidence_type, detail_json, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(sessionId, filePath, type, JSON.stringify(detail), Date.now());
}

export function getEvidenceForFile(filePath: string): any[] {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const rows = db.prepare(`
    SELECT evidence_type, detail_json, timestamp
    FROM evidence
    WHERE session_id = ? AND file_path = ?
    ORDER BY timestamp DESC
  `).all(sessionId, filePath) as Array<{
    evidence_type: string;
    detail_json: string;
    timestamp: number;
  }>;

  return rows.map(row => ({
    type: row.evidence_type,
    detail: JSON.parse(row.detail_json),
    timestamp: row.timestamp
  }));
}

export function getSessionConfig(): { mode: string } {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const row = db.prepare('SELECT mode FROM sessions WHERE id = ?').get(sessionId) as { mode: string } | undefined;

  return {
    mode: row?.mode || 'warn'
  };
}

export function setSessionMode(mode: string) {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  db.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run(mode, sessionId);
}

// Evidence helper functions

export function getMode(): string {
  return getSessionConfig().mode;
}

export interface EvidenceSummary {
  fileWasRead: boolean;
  fileWasGrepped: boolean;
}

export function getEvidenceFor(filePath: string): EvidenceSummary {
  const evidence = getEvidenceForFile(filePath);
  return {
    fileWasRead: evidence.some(e => e.type === 'file_read'),
    fileWasGrepped: evidence.some(e => e.type === 'grep_hit')
  };
}

export function markFileRead(filePath: string, detail?: Record<string, any>): void {
  updateEvidence(filePath, 'file_read', { source: 'Read', ...detail });
}

export function markFileGrepped(filePath: string, pattern?: string): void {
  updateEvidence(filePath, 'grep_hit', { source: 'Grep', pattern });
}

// Verification functions

export interface VerifyResult {
  mode: 'full' | 'fast';
  checks: Array<{
    name: string;
    passed: boolean;
    output?: string;
    duration_ms: number;
    label?: string;
  }>;
  allPassing: boolean;
  duration_ms: number;
}

export function logVerifyResult(result: VerifyResult) {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  db.prepare(`
    INSERT INTO verify_results (session_id, timestamp, mode, checks_json, all_passing, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    Date.now(),
    result.mode,
    JSON.stringify(result.checks),
    result.allPassing ? 1 : 0,
    result.duration_ms
  );
}

export function getLastVerifyResult(): VerifyResult | null {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const row = db.prepare(`
    SELECT mode, checks_json, all_passing, duration_ms, timestamp
    FROM verify_results
    WHERE session_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(sessionId) as any;

  if (!row) return null;

  return {
    mode: row.mode,
    checks: JSON.parse(row.checks_json),
    allPassing: row.all_passing === 1,
    duration_ms: row.duration_ms
  };
}

// Baseline functions for verification

export interface BaselineResult {
  checkName: string;
  passed: boolean;
  capturedAt: number;
}

/**
 * Get the verification baseline for current session
 * Returns null if no baseline has been captured yet
 */
export function getBaseline(): Map<string, boolean> | null {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  try {
    const rows = db.prepare(`
      SELECT check_name, passed FROM verification_baseline
      WHERE session_id = ?
    `).all(sessionId) as Array<{ check_name: string; passed: number }>;

    if (rows.length === 0) return null;

    const baseline = new Map<string, boolean>();
    for (const row of rows) {
      baseline.set(row.check_name, row.passed === 1);
    }
    return baseline;
  } catch {
    // Table doesn't exist - create it now (self-healing)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS verification_baseline (
          session_id TEXT NOT NULL,
          check_name TEXT NOT NULL,
          passed INTEGER NOT NULL,
          captured_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, check_name)
        );
        CREATE INDEX IF NOT EXISTS idx_baseline_session ON verification_baseline(session_id);
      `);
    } catch {
      // Ignore creation errors
    }
    return null;
  }
}

/**
 * Set the verification baseline for current session
 * Called once when session starts to capture pre-existing failures
 */
export function setBaseline(checks: Array<{ name: string; passed: boolean }>): void {
  const db = getDb();
  const sessionId = getCurrentSessionId();
  const now = Date.now();

  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO verification_baseline (session_id, check_name, passed, captured_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const check of checks) {
      insert.run(sessionId, check.name, check.passed ? 1 : 0, now);
    }
  } catch {
    // Table doesn't exist - create it and retry (self-healing)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS verification_baseline (
          session_id TEXT NOT NULL,
          check_name TEXT NOT NULL,
          passed INTEGER NOT NULL,
          captured_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, check_name)
        );
        CREATE INDEX IF NOT EXISTS idx_baseline_session ON verification_baseline(session_id);
      `);

      // Retry the insert
      const insert = db.prepare(`
        INSERT OR REPLACE INTO verification_baseline (session_id, check_name, passed, captured_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const check of checks) {
        insert.run(sessionId, check.name, check.passed ? 1 : 0, now);
      }
    } catch {
      // Still failing - give up silently
    }
  }
}

/**
 * Check if a failure is a regression (was passing in baseline, now failing)
 */
export function isBaselineRegression(checkName: string, currentlyPassing: boolean): boolean {
  const baseline = getBaseline();
  if (!baseline) return false;

  const wasPassingAtStart = baseline.get(checkName);
  if (wasPassingAtStart === undefined) return false;

  // It's a regression if it was passing but now failing
  return wasPassingAtStart && !currentlyPassing;
}

// Decision logging

export interface DecisionLogEntry {
  decisionType: string;
  decision: 'allow' | 'block' | 'warn';
  reason?: string;
  userOverride?: boolean;
}

export function logDecision(entry: DecisionLogEntry) {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  db.prepare(`
    INSERT INTO decision_log (timestamp, session_id, decision_type, decision, reason, user_override)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(),
    sessionId,
    entry.decisionType,
    entry.decision,
    entry.reason || null,
    entry.userOverride ? 1 : 0
  );
}

// Quality events

export interface QualityEvent {
  checkName: string;
  passed: boolean;
  outputSummary?: string;
  changedFiles: string[];
  isRegression: boolean;
  timestamp: number;
}

export function logQualityEvent(event: QualityEvent): void {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  db.prepare(`
    INSERT INTO quality_events (
      session_id,
      timestamp,
      check_name,
      passed,
      output_summary,
      changed_files_json,
      is_regression
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    event.timestamp,
    event.checkName,
    event.passed ? 1 : 0,
    event.outputSummary || null,
    JSON.stringify(event.changedFiles),
    event.isRegression ? 1 : 0
  );
}

export function getQualityEvents(options: {
  sessionId?: string;
  limit?: number;
  onlyFailures?: boolean;
  allSessions?: boolean;
} = {}): QualityEvent[] {
  const db = getDb();
  const sessionId = options.sessionId || getCurrentSessionId();
  const limit = options.limit ?? 50;
  const failureClause = options.onlyFailures ? 'AND passed = 0' : '';
  const sessionClause = options.allSessions ? '' : 'session_id = ? AND';
  const params = options.allSessions ? [limit] : [sessionId, limit];

  const rows = db.prepare(`
    SELECT
      check_name,
      passed,
      output_summary,
      changed_files_json,
      is_regression,
      timestamp
    FROM quality_events
    WHERE ${sessionClause} 1=1
      ${failureClause}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params) as Array<{
    check_name: string;
    passed: number;
    output_summary: string | null;
    changed_files_json: string;
    is_regression: number;
    timestamp: number;
  }>;

  return rows.map(row => ({
    checkName: row.check_name,
    passed: row.passed === 1,
    outputSummary: row.output_summary || undefined,
    changedFiles: JSON.parse(row.changed_files_json),
    isRegression: row.is_regression === 1,
    timestamp: row.timestamp
  }));
}

// Metrics

export function updateMetric(metric: string, increment: number = 1) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  // Validate metric name to prevent SQL injection
  const validMetrics = [
    'stop_blocks', 'stop_allows', 'edit_blocks', 'edit_warns',
    'verify_runs', 'false_positives', 'rage_quits', 'loop_detections',
    'session_saves'
  ];

  if (!validMetrics.includes(metric)) {
    throw new Error(`Invalid metric name: ${metric}`);
  }

  // Ensure row exists for today
  db.prepare('INSERT OR IGNORE INTO wink_metrics (date) VALUES (?)').run(today);

  // Update the specific metric
  db.prepare(`UPDATE wink_metrics SET ${metric} = ${metric} + ? WHERE date = ?`).run(increment, today);
}

export function getMetrics(days: number = 7): any[] {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);

  return db.prepare(`
    SELECT * FROM wink_metrics
    WHERE date >= ?
    ORDER BY date DESC
  `).all(since.toISOString().split('T')[0]);
}

// Session stats for analysis

export function getSessionReadCount(): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ? AND tool = 'Read'
  `).get(sessionId) as { count: number };

  return result.count;
}

export function getSessionErrorCount(): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ? AND success = 0
  `).get(sessionId) as { count: number };

  return result.count;
}
