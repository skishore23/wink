/**
 * Agent Predictor
 *
 * Predicts which agents would be helpful based on current context
 * by comparing to historical contexts where agents were effective.
 */

import {
  getDb,
  getCurrentSessionId,
  saveContextFeatures,
  findSimilarContexts,
  ContextFeatures
} from './storage';

export interface AgentPrediction {
  agentName: string;
  confidence: number;
  reason: string;
  similarContexts: number;
}

/**
 * Extract context features from the current session
 */
export function extractCurrentFeatures(): ContextFeatures {
  const db = getDb();
  const sessionId = getCurrentSessionId();

  // Get folder activity (edit counts per folder)
  const folderActivity: Record<string, number> = {};
  const folderRows = db.prepare(`
    SELECT
      CASE
        WHEN json_extract(input_json, '$.file_path') IS NOT NULL
        THEN SUBSTR(json_extract(input_json, '$.file_path'), 1,
          INSTR(json_extract(input_json, '$.file_path') || '/', '/') - 1)
        ELSE 'unknown'
      END as folder,
      COUNT(*) as count
    FROM events
    WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit')
    GROUP BY folder
  `).all(sessionId) as Array<{ folder: string; count: number }>;

  for (const row of folderRows) {
    if (row.folder && row.folder !== 'unknown') {
      folderActivity[row.folder] = row.count;
    }
  }

  // Get file types (edit counts per extension)
  // Extract extension using path parsing in JavaScript instead of SQL
  const fileTypes: Record<string, number> = {};
  const editRows = db.prepare(`
    SELECT json_extract(input_json, '$.file_path') as file_path
    FROM events
    WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit')
      AND json_extract(input_json, '$.file_path') IS NOT NULL
  `).all(sessionId) as Array<{ file_path: string }>;

  for (const row of editRows) {
    if (row.file_path) {
      const ext = row.file_path.split('.').pop() || 'unknown';
      fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    }
  }

  // Calculate error rate
  const eventCounts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
    FROM events
    WHERE session_id = ?
  `).get(sessionId) as { total: number; errors: number };

  const errorRate = eventCounts.total > 0
    ? eventCounts.errors / eventCounts.total
    : 0;

  // Calculate loop rate (files read multiple times)
  const readCounts = db.prepare(`
    SELECT json_extract(input_json, '$.file_path') as file, COUNT(*) as count
    FROM events
    WHERE session_id = ? AND tool = 'Read'
    GROUP BY file
    HAVING count > 1
  `).all(sessionId) as Array<{ file: string; count: number }>;

  const totalReads = db.prepare(`
    SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as unique_files
    FROM events
    WHERE session_id = ? AND tool = 'Read'
  `).get(sessionId) as { unique_files: number };

  const loopRate = totalReads.unique_files > 0
    ? readCounts.length / totalReads.unique_files
    : 0;

  // Get tool distribution
  const toolDistribution: Record<string, number> = {};
  const toolRows = db.prepare(`
    SELECT tool, COUNT(*) as count
    FROM events
    WHERE session_id = ?
    GROUP BY tool
  `).all(sessionId) as Array<{ tool: string; count: number }>;

  for (const row of toolRows) {
    toolDistribution[row.tool] = row.count;
  }

  return {
    folderActivity,
    fileTypes,
    errorRate,
    loopRate,
    toolDistribution
  };
}

/**
 * Predict which agent would be most helpful for the current context
 */
export function predictAgent(): AgentPrediction | null {
  const features = extractCurrentFeatures();

  // Find similar historical contexts
  const matches = findSimilarContexts(features, 5);

  if (matches.length === 0) {
    return null;
  }

  // Vote for best agent weighted by similarity
  const votes = new Map<string, { score: number; count: number }>();

  for (const match of matches) {
    const current = votes.get(match.usefulAgent) || { score: 0, count: 0 };
    votes.set(match.usefulAgent, {
      score: current.score + match.similarity * match.effectiveness,
      count: current.count + 1
    });
  }

  // Find the top voted agent
  let topAgent: string | null = null;
  let topScore = 0;
  let topCount = 0;

  for (const [agent, data] of votes) {
    if (data.score > topScore) {
      topAgent = agent;
      topScore = data.score;
      topCount = data.count;
    }
  }

  if (!topAgent || topScore < 0.3) {
    return null; // Not confident enough
  }

  // Calculate confidence (normalized by max possible score)
  const maxPossibleScore = matches.length; // Each match could contribute max 1.0
  const confidence = Math.min(1, topScore / maxPossibleScore);

  return {
    agentName: topAgent,
    confidence,
    reason: `Similar to ${topCount} previous contexts where ${topAgent} was helpful`,
    similarContexts: matches.length
  };
}

/**
 * Record that an agent was useful in the current context
 * Call this after an agent successfully completes a task
 */
export function recordUsefulAgent(agentName: string, effectiveness: number): void {
  const features = extractCurrentFeatures();
  saveContextFeatures(features, agentName, effectiveness);
}

/**
 * Get prediction confidence threshold
 * Only suggest agents with confidence above this
 */
export const MIN_PREDICTION_CONFIDENCE = 0.4;

/**
 * Check if we should proactively suggest an agent
 */
export function shouldSuggestAgent(): AgentPrediction | null {
  const prediction = predictAgent();

  if (!prediction) return null;

  if (prediction.confidence < MIN_PREDICTION_CONFIDENCE) {
    return null;
  }

  return prediction;
}

/**
 * Format prediction for display
 */
export function formatPrediction(prediction: AgentPrediction): string {
  const confidencePercent = Math.round(prediction.confidence * 100);
  return `💡 Suggested: ${prediction.agentName} (${confidencePercent}% confidence) - ${prediction.reason}`;
}
