#!/usr/bin/env node
// Stop gate - blocks Claude from stopping when verification needed

import { getDb, getCurrentSessionId, getLastVerifyResult, logDecision, updateMetric } from '../core/storage';
import { readStdin } from '../core/hookRunner';
import { analyzeContextHygiene, formatSessionSummary } from '../core/contextHygiene';
import { getConfig } from '../core/config';
import * as path from 'path';


interface StopGateInput {
  tool_name: string;
  tool_input: unknown;
}

interface StopGateOutput {
  decision?: "approve" | "block";
  reason?: string;
}

async function main() {
  try {
    const input = await readStdin();
    const parsed: StopGateInput = JSON.parse(input);
    const output = await stopGate(parsed);

    console.log(JSON.stringify(output));
    process.exit(0);
  } catch {
    console.log(JSON.stringify({ decision: "approve" }));
    process.exit(0);
  }
}

async function stopGate(_input: StopGateInput): Promise<StopGateOutput> {
  const db = getDb();
  const sessionId = getCurrentSessionId();
  const config = await getConfig();

  // Helper to output reason visibly
  const blockWith = (reason: string, instruction: string): StopGateOutput => {
    process.stderr.write(`\n\x1b[33m${reason}\x1b[0m\n`);
    return {
      decision: "block",
      reason: `${reason}. ${instruction}`
    };
  };

  try {
    // Check if any edits were made this session
    const sessionEdits = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE session_id = ? AND tool IN ('Write', 'Edit', 'MultiEdit')
    `).get(sessionId) as { count: number };

    const hasEdits = sessionEdits.count > 0;

    // If onlyAfterEdits is enabled and no edits were made, allow stop
    if (config.stopDiscipline.onlyAfterEdits && !hasEdits) {
      logDecision({ decisionType: 'stop_gate', decision: 'allow', reason: 'no_edits' });
      updateMetric('stop_allows');

      // Show hygiene summary even for analysis-only sessions
      const hygiene = analyzeContextHygiene(sessionId);
      const summary = formatSessionSummary(hygiene);
      process.stderr.write(`\n\x1b[2m${summary}\x1b[0m\n`);

      return { decision: "approve" };
    }

    // Check 1: Has any verification run this session?
    const verifyCount = db.prepare(`
      SELECT COUNT(*) as count FROM verify_results WHERE session_id = ?
    `).get(sessionId) as { count: number };

    if (verifyCount.count === 0) {
      logDecision({ decisionType: 'stop_gate', decision: 'block', reason: 'no_verification' });
      updateMetric('stop_blocks');

      return blockWith(`✗ wink · no verification run`, `Run /verify to check your changes`);
    }

    // Check 2: Is last verification passing?
    const lastVerify = getLastVerifyResult();

    if (lastVerify && !lastVerify.allPassing) {
      const failing = lastVerify.checks.filter(c => !c.passed).map(c => c.name);

      logDecision({ decisionType: 'stop_gate', decision: 'block', reason: 'verification_failing' });
      updateMetric('stop_blocks');

      return blockWith(`✗ wink · ${failing.join(', ')} failing`, `Run /verify and fix the failing checks`);
    }

    // Check 3: Any edits since last verify?
    const lastVerifyTime = db.prepare(`
      SELECT MAX(timestamp) as timestamp FROM verify_results WHERE session_id = ?
    `).get(sessionId) as { timestamp: number | null };

    const editsAfterVerify = db.prepare(`
      SELECT json_extract(input_json, '$.file_path') as file_path
      FROM events
      WHERE session_id = ?
        AND tool IN ('Write', 'Edit', 'MultiEdit')
        AND timestamp > ?
        AND input_json IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(sessionId, lastVerifyTime?.timestamp || 0) as Array<{ file_path: string }>;

    if (editsAfterVerify.length > 0) {
      const uniqueFiles = [...new Set(editsAfterVerify.map(e => path.basename(e.file_path)))];

      logDecision({ decisionType: 'stop_gate', decision: 'block', reason: 'unverified_edits' });
      updateMetric('stop_blocks');

      return blockWith(
        `✗ wink · unverified: ${uniqueFiles.slice(0, 3).join(', ')}${uniqueFiles.length > 3 ? ` +${uniqueFiles.length - 3}` : ''}`,
        `Run /verify to check these edits before stopping`
      );
    }

    // All checks passed - show session summary
    logDecision({ decisionType: 'stop_gate', decision: 'allow' });
    updateMetric('stop_allows');

    // Display session hygiene summary
    const hygiene = analyzeContextHygiene(sessionId);
    const summary = formatSessionSummary(hygiene);
    process.stderr.write(`\n\x1b[2m${summary}\x1b[0m\n`);

    return { decision: "approve" };

  } catch {
    return { decision: "approve" };
  }
}

if (import.meta.main) {
  void main();
}
