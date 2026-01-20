import { Database } from "bun:sqlite";
import * as path from 'path';
import * as fs from 'fs';

let db: Database | null = null;

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
    
    // Initialize schema
    initSchema(db);
  }
  
  return db;
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER,
      mode TEXT DEFAULT 'warn',
      current INTEGER DEFAULT 1
    );
    
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
    
    CREATE TABLE IF NOT EXISTS evidence (
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      detail_json TEXT,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_id, file_path, evidence_type)
    );
    
    -- Aggregate metrics tables
    CREATE TABLE IF NOT EXISTS verify_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      mode TEXT NOT NULL, -- 'full' or 'fast'
      checks_json TEXT NOT NULL,
      all_passing INTEGER NOT NULL,
      duration_ms INTEGER
    );
    
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
    
    CREATE TABLE IF NOT EXISTS decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      user_override INTEGER DEFAULT 0,
      was_correct INTEGER -- null until validated
    );

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
    
    -- Recovery tracking for auto-recovery feature
    CREATE TABLE IF NOT EXISTS recovery_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      failure_pattern TEXT NOT NULL,
      strategy_type TEXT NOT NULL,
      strategy_title TEXT NOT NULL,
      was_accepted INTEGER DEFAULT 0,
      followed_by_success INTEGER DEFAULT 0
    );
    
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

    -- Self-learning system tables

    -- Agent usage tracking for effectiveness measurement
    CREATE TABLE IF NOT EXISTS agent_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      trigger_context TEXT,

      -- Baseline metrics at spawn time
      reads_at_spawn INTEGER DEFAULT 0,
      errors_at_spawn INTEGER DEFAULT 0,

      -- Outcome metrics (updated after completion)
      completed INTEGER DEFAULT 0,
      task_success INTEGER,
      reads_after INTEGER,
      errors_after INTEGER,

      -- Computed effectiveness (0-1)
      effectiveness_score REAL
    );

    -- Learned error patterns (normalized and clustered)
    CREATE TABLE IF NOT EXISTS learned_error_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_hash TEXT UNIQUE NOT NULL,
      canonical_form TEXT NOT NULL,
      category TEXT,
      suggested_agent TEXT,
      occurrence_count INTEGER DEFAULT 1,
      fix_count INTEGER DEFAULT 0,
      fix_success_rate REAL DEFAULT 0,
      last_seen INTEGER,
      associated_folders_json TEXT
    );

    -- Individual error instances
    CREATE TABLE IF NOT EXISTS error_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      pattern_id INTEGER,
      raw_error TEXT NOT NULL,
      file_path TEXT,
      was_fixed INTEGER DEFAULT 0,
      fix_agent TEXT,
      FOREIGN KEY (pattern_id) REFERENCES learned_error_patterns(id)
    );

    -- Adaptive thresholds per agent type
    CREATE TABLE IF NOT EXISTS agent_thresholds (
      agent_type TEXT PRIMARY KEY,
      threshold_value REAL NOT NULL,
      min_value REAL DEFAULT 3,
      max_value REAL DEFAULT 100,
      effectiveness_avg REAL DEFAULT 0.5,
      sample_count INTEGER DEFAULT 0,
      last_adjusted INTEGER,
      adjustment_history_json TEXT
    );

    -- Context features for prediction
    CREATE TABLE IF NOT EXISTS context_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      folder_activity_json TEXT,
      file_types_json TEXT,
      error_rate REAL,
      loop_rate REAL,
      tool_distribution_json TEXT,
      useful_agent TEXT,
      agent_effectiveness REAL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_usage_session
      ON agent_usage(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_type
      ON agent_usage(agent_type);
    CREATE INDEX IF NOT EXISTS idx_error_instances_session
      ON error_instances(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_error_instances_pattern
      ON error_instances(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_context_features_session
      ON context_features(session_id);
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
 * Used to run targeted verification only on changed files
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

// Evidence helper functions (aliases for compatibility)

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

// Metrics and monitoring functions

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
  
  // Update the specific metric - safe because metric is validated
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

// ============================================================================
// Self-Learning System Functions
// ============================================================================

// Agent Usage Tracking

export interface AgentSpawnData {
  agentName: string;
  agentType: string;
  triggerContext?: string;
}

export interface AgentBaselines {
  readsAtSpawn: number;
  errorsAtSpawn: number;
}

export interface AgentOutcome {
  taskSuccess: boolean;
  readsAfter: number;
  errorsAfter: number;
}

/**
 * Log when an agent is spawned, capturing baseline metrics
 */
export function logAgentSpawn(data: AgentSpawnData, baselines: AgentBaselines): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    INSERT INTO agent_usage (
      session_id, timestamp, agent_name, agent_type, trigger_context,
      reads_at_spawn, errors_at_spawn
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    Date.now(),
    data.agentName,
    data.agentType,
    data.triggerContext || null,
    baselines.readsAtSpawn,
    baselines.errorsAtSpawn
  );

  return Number(result.lastInsertRowid);
}

/**
 * Update agent usage with outcome metrics after completion
 */
export function updateAgentOutcome(usageId: number, outcome: AgentOutcome): void {
  const db = getDb();

  // Get baseline to calculate effectiveness
  const usage = db.prepare(`
    SELECT reads_at_spawn, errors_at_spawn FROM agent_usage WHERE id = ?
  `).get(usageId) as { reads_at_spawn: number; errors_at_spawn: number } | undefined;

  if (!usage) return;

  // Calculate effectiveness score
  const effectiveness = calculateEffectiveness(
    usage.reads_at_spawn,
    usage.errors_at_spawn,
    outcome.readsAfter,
    outcome.errorsAfter,
    outcome.taskSuccess
  );

  db.prepare(`
    UPDATE agent_usage
    SET completed = 1, task_success = ?, reads_after = ?, errors_after = ?, effectiveness_score = ?
    WHERE id = ?
  `).run(
    outcome.taskSuccess ? 1 : 0,
    outcome.readsAfter,
    outcome.errorsAfter,
    effectiveness,
    usageId
  );
}

/**
 * Calculate effectiveness score (0-1) based on before/after metrics
 */
function calculateEffectiveness(
  readsAtSpawn: number,
  errorsAtSpawn: number,
  readsAfter: number,
  errorsAfter: number,
  taskSuccess: boolean
): number {
  let score = 0;

  // Re-read reduction (40% weight)
  if (readsAtSpawn > 0) {
    const readReduction = Math.max(0, 1 - readsAfter / readsAtSpawn);
    score += readReduction * 0.4;
  } else {
    score += 0.2; // Neutral if no baseline
  }

  // Error reduction (30% weight)
  if (errorsAtSpawn > 0) {
    const errorReduction = Math.max(0, 1 - errorsAfter / errorsAtSpawn);
    score += errorReduction * 0.3;
  } else if (errorsAfter === 0) {
    score += 0.3; // Full credit if no new errors
  }

  // Task success (30% weight)
  if (taskSuccess) {
    score += 0.3;
  }

  return Math.min(1, Math.max(0, score));
}

/**
 * Get current read count for the session (for baselines)
 */
export function getSessionReadCount(): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ? AND tool = 'Read'
  `).get(sessionId) as { count: number };

  return result.count;
}

/**
 * Get current error count for the session (for baselines)
 */
export function getSessionErrorCount(): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ? AND success = 0
  `).get(sessionId) as { count: number };

  return result.count;
}

/**
 * Get the most recent incomplete agent usage for the session
 */
export function getActiveAgentUsage(): { id: number; agentName: string } | null {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    SELECT id, agent_name FROM agent_usage
    WHERE session_id = ? AND completed = 0
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(sessionId) as { id: number; agent_name: string } | undefined;

  return result ? { id: result.id, agentName: result.agent_name } : null;
}

/**
 * Get agent effectiveness statistics by type
 */
export interface AgentEffectivenessStats {
  agentType: string;
  sampleCount: number;
  avgEffectiveness: number;
  successRate: number;
}

export function getAgentEffectiveness(agentType: string, days: number = 30): AgentEffectivenessStats | null {
  const db = getDb();
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);

  const result = db.prepare(`
    SELECT
      agent_type,
      COUNT(*) as sample_count,
      AVG(effectiveness_score) as avg_effectiveness,
      AVG(CASE WHEN task_success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
    FROM agent_usage
    WHERE agent_type = ? AND completed = 1 AND timestamp >= ?
    GROUP BY agent_type
  `).get(agentType, since) as {
    agent_type: string;
    sample_count: number;
    avg_effectiveness: number | null;
    success_rate: number | null;
  } | undefined;

  if (!result) return null;

  return {
    agentType: result.agent_type,
    sampleCount: result.sample_count,
    avgEffectiveness: result.avg_effectiveness ?? 0,
    successRate: result.success_rate ?? 0
  };
}

/**
 * Get all agent effectiveness stats for learning insights
 */
export function getAllAgentEffectiveness(days: number = 30): AgentEffectivenessStats[] {
  const db = getDb();
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);

  const results = db.prepare(`
    SELECT
      agent_type,
      COUNT(*) as sample_count,
      AVG(effectiveness_score) as avg_effectiveness,
      AVG(CASE WHEN task_success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
    FROM agent_usage
    WHERE completed = 1 AND timestamp >= ?
    GROUP BY agent_type
    ORDER BY avg_effectiveness DESC
  `).all(since) as Array<{
    agent_type: string;
    sample_count: number;
    avg_effectiveness: number | null;
    success_rate: number | null;
  }>;

  return results.map(r => ({
    agentType: r.agent_type,
    sampleCount: r.sample_count,
    avgEffectiveness: r.avg_effectiveness ?? 0,
    successRate: r.success_rate ?? 0
  }));
}

// Error Pattern Learning

export interface ErrorPattern {
  id: number;
  patternHash: string;
  canonicalForm: string;
  category: string | null;
  suggestedAgent: string | null;
  occurrenceCount: number;
  fixSuccessRate: number;
}

/**
 * Find or create an error pattern
 */
export function findOrCreateErrorPattern(hash: string, canonicalForm: string, category?: string): number {
  const db = getDb();

  // Try to find existing
  const existing = db.prepare(`
    SELECT id FROM learned_error_patterns WHERE pattern_hash = ?
  `).get(hash) as { id: number } | undefined;

  if (existing) {
    // Update occurrence count and last seen
    db.prepare(`
      UPDATE learned_error_patterns
      SET occurrence_count = occurrence_count + 1, last_seen = ?
      WHERE id = ?
    `).run(Date.now(), existing.id);
    return existing.id;
  }

  // Create new pattern
  const result = db.prepare(`
    INSERT INTO learned_error_patterns (pattern_hash, canonical_form, category, last_seen)
    VALUES (?, ?, ?, ?)
  `).run(hash, canonicalForm, category || null, Date.now());

  return Number(result.lastInsertRowid);
}

/**
 * Log an error instance
 */
export function logErrorInstance(patternId: number, rawError: string, filePath?: string): number {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  const result = db.prepare(`
    INSERT INTO error_instances (session_id, timestamp, pattern_id, raw_error, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, Date.now(), patternId, rawError, filePath || null);

  return Number(result.lastInsertRowid);
}

/**
 * Mark an error as fixed and attribute to an agent
 */
export function markErrorFixed(instanceId: number, fixAgent?: string): void {
  const db = getDb();

  db.prepare(`
    UPDATE error_instances SET was_fixed = 1, fix_agent = ? WHERE id = ?
  `).run(fixAgent || null, instanceId);

  // Update pattern fix stats
  const instance = db.prepare(`
    SELECT pattern_id FROM error_instances WHERE id = ?
  `).get(instanceId) as { pattern_id: number } | undefined;

  if (instance?.pattern_id) {
    db.prepare(`
      UPDATE learned_error_patterns
      SET fix_count = fix_count + 1,
          fix_success_rate = CAST(fix_count + 1 AS REAL) / occurrence_count
      WHERE id = ?
    `).run(instance.pattern_id);
  }
}

/**
 * Get top error patterns
 */
export function getTopErrorPatterns(limit: number = 10): ErrorPattern[] {
  const db = getDb();

  const results = db.prepare(`
    SELECT id, pattern_hash, canonical_form, category, suggested_agent,
           occurrence_count, fix_success_rate
    FROM learned_error_patterns
    ORDER BY occurrence_count DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    pattern_hash: string;
    canonical_form: string;
    category: string | null;
    suggested_agent: string | null;
    occurrence_count: number;
    fix_success_rate: number;
  }>;

  return results.map(r => ({
    id: r.id,
    patternHash: r.pattern_hash,
    canonicalForm: r.canonical_form,
    category: r.category,
    suggestedAgent: r.suggested_agent,
    occurrenceCount: r.occurrence_count,
    fixSuccessRate: r.fix_success_rate
  }));
}

// Adaptive Thresholds

export interface ThresholdConfig {
  agentType: string;
  thresholdValue: number;
  minValue: number;
  maxValue: number;
  effectivenessAvg: number;
  sampleCount: number;
}

/**
 * Get threshold for an agent type (with defaults)
 */
export function getAgentThreshold(agentType: string): ThresholdConfig {
  const db = getDb();

  const defaults: Record<string, number> = {
    'folder-expert': 20,
    'error-fixer': 3,
    'context-keeper': 5,
    'language-specialist': 1,
    'quality-guard': 1,
    'regression-fixer': 1
  };

  const result = db.prepare(`
    SELECT agent_type, threshold_value, min_value, max_value, effectiveness_avg, sample_count
    FROM agent_thresholds
    WHERE agent_type = ?
  `).get(agentType) as {
    agent_type: string;
    threshold_value: number;
    min_value: number;
    max_value: number;
    effectiveness_avg: number;
    sample_count: number;
  } | undefined;

  if (result) {
    return {
      agentType: result.agent_type,
      thresholdValue: result.threshold_value,
      minValue: result.min_value,
      maxValue: result.max_value,
      effectivenessAvg: result.effectiveness_avg,
      sampleCount: result.sample_count
    };
  }

  // Return default
  return {
    agentType,
    thresholdValue: defaults[agentType] ?? 10,
    minValue: 3,
    maxValue: 100,
    effectivenessAvg: 0.5,
    sampleCount: 0
  };
}

/**
 * Update threshold for an agent type
 */
export function updateAgentThreshold(
  agentType: string,
  newValue: number,
  effectivenessAvg: number,
  sampleCount: number
): void {
  const db = getDb();
  const current = getAgentThreshold(agentType);

  // Build adjustment history
  const history = [];
  try {
    const existing = db.prepare(`
      SELECT adjustment_history_json FROM agent_thresholds WHERE agent_type = ?
    `).get(agentType) as { adjustment_history_json: string | null } | undefined;
    if (existing?.adjustment_history_json) {
      history.push(...JSON.parse(existing.adjustment_history_json));
    }
  } catch {
    // Ignore parse errors
  }

  history.push({
    timestamp: Date.now(),
    oldValue: current.thresholdValue,
    newValue,
    reason: `effectiveness ${effectivenessAvg.toFixed(2)}`
  });

  // Keep last 10 adjustments
  const recentHistory = history.slice(-10);

  db.prepare(`
    INSERT INTO agent_thresholds (agent_type, threshold_value, effectiveness_avg, sample_count, last_adjusted, adjustment_history_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_type) DO UPDATE SET
      threshold_value = excluded.threshold_value,
      effectiveness_avg = excluded.effectiveness_avg,
      sample_count = excluded.sample_count,
      last_adjusted = excluded.last_adjusted,
      adjustment_history_json = excluded.adjustment_history_json
  `).run(
    agentType,
    newValue,
    effectivenessAvg,
    sampleCount,
    Date.now(),
    JSON.stringify(recentHistory)
  );
}

/**
 * Get all thresholds for display
 */
export function getAllThresholds(): ThresholdConfig[] {
  const db = getDb();

  const results = db.prepare(`
    SELECT agent_type, threshold_value, min_value, max_value, effectiveness_avg, sample_count
    FROM agent_thresholds
    ORDER BY agent_type
  `).all() as Array<{
    agent_type: string;
    threshold_value: number;
    min_value: number;
    max_value: number;
    effectiveness_avg: number;
    sample_count: number;
  }>;

  return results.map(r => ({
    agentType: r.agent_type,
    thresholdValue: r.threshold_value,
    minValue: r.min_value,
    maxValue: r.max_value,
    effectivenessAvg: r.effectiveness_avg,
    sampleCount: r.sample_count
  }));
}

// Context Features for Prediction

export interface ContextFeatures {
  folderActivity: Record<string, number>;
  fileTypes: Record<string, number>;
  errorRate: number;
  loopRate: number;
  toolDistribution: Record<string, number>;
}

/**
 * Save context features with associated useful agent
 */
export function saveContextFeatures(
  features: ContextFeatures,
  usefulAgent: string,
  effectiveness: number
): void {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  db.prepare(`
    INSERT INTO context_features (
      session_id, timestamp, folder_activity_json, file_types_json,
      error_rate, loop_rate, tool_distribution_json, useful_agent, agent_effectiveness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    Date.now(),
    JSON.stringify(features.folderActivity),
    JSON.stringify(features.fileTypes),
    features.errorRate,
    features.loopRate,
    JSON.stringify(features.toolDistribution),
    usefulAgent,
    effectiveness
  );
}

/**
 * Find similar contexts for prediction
 */
export interface ContextMatch {
  usefulAgent: string;
  effectiveness: number;
  similarity: number;
}

export function findSimilarContexts(features: ContextFeatures, limit: number = 5): ContextMatch[] {
  const db = getDb();

  // Get recent context features with good effectiveness
  const contexts = db.prepare(`
    SELECT folder_activity_json, file_types_json, error_rate, loop_rate,
           tool_distribution_json, useful_agent, agent_effectiveness
    FROM context_features
    WHERE agent_effectiveness >= 0.4
    ORDER BY timestamp DESC
    LIMIT 100
  `).all() as Array<{
    folder_activity_json: string;
    file_types_json: string;
    error_rate: number;
    loop_rate: number;
    tool_distribution_json: string;
    useful_agent: string;
    agent_effectiveness: number;
  }>;

  // Calculate similarity for each
  const matches: ContextMatch[] = [];

  for (const ctx of contexts) {
    const ctxFeatures: ContextFeatures = {
      folderActivity: JSON.parse(ctx.folder_activity_json || '{}'),
      fileTypes: JSON.parse(ctx.file_types_json || '{}'),
      errorRate: ctx.error_rate,
      loopRate: ctx.loop_rate,
      toolDistribution: JSON.parse(ctx.tool_distribution_json || '{}')
    };

    const similarity = computeContextSimilarity(features, ctxFeatures);

    if (similarity >= 0.3) {
      matches.push({
        usefulAgent: ctx.useful_agent,
        effectiveness: ctx.agent_effectiveness,
        similarity
      });
    }
  }

  // Sort by similarity and take top matches
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, limit);
}

/**
 * Compute similarity between two contexts (0-1)
 */
function computeContextSimilarity(a: ContextFeatures, b: ContextFeatures): number {
  // Folder similarity (Jaccard index)
  const foldersA = new Set(Object.keys(a.folderActivity));
  const foldersB = new Set(Object.keys(b.folderActivity));
  const folderIntersection = [...foldersA].filter(x => foldersB.has(x)).length;
  const folderUnion = new Set([...foldersA, ...foldersB]).size;
  const folderSim = folderUnion > 0 ? folderIntersection / folderUnion : 0;

  // File type similarity
  const typesA = new Set(Object.keys(a.fileTypes));
  const typesB = new Set(Object.keys(b.fileTypes));
  const typeIntersection = [...typesA].filter(x => typesB.has(x)).length;
  const typeUnion = new Set([...typesA, ...typesB]).size;
  const typeSim = typeUnion > 0 ? typeIntersection / typeUnion : 0;

  // Rate similarities (inverse of absolute difference)
  const errorRateSim = 1 - Math.min(1, Math.abs(a.errorRate - b.errorRate));
  const loopRateSim = 1 - Math.min(1, Math.abs(a.loopRate - b.loopRate));

  // Weighted average
  return folderSim * 0.4 + typeSim * 0.2 + errorRateSim * 0.2 + loopRateSim * 0.2;
}