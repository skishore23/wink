#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { getDb, getCurrentSessionId, getLastVerifyResult, getQualityEvents } from '../core/storage';
import { analyzeContextHygiene, formatHygieneWarning } from '../core/contextHygiene';

// Minimal session context - current session only, from database

async function main() {
  try {
    const db = getDb();
    const sessionId = getCurrentSessionId();
    const parts: string[] = [];

    // Verification status
    const lastVerify = getLastVerifyResult();
    if (lastVerify) {
      if (lastVerify.allPassing) {
        parts.push('✓ verified');
      } else {
        const fails = lastVerify.checks.filter(c => !c.passed).map(c => c.name).slice(0, 2).join(', ');
        parts.push(`✗ ${fails} failing`);
      }
    }

    // Unverified edits (current session, since last verify)
    const lastVerifyTime = db.prepare(`
      SELECT MAX(timestamp) as ts FROM verify_results WHERE session_id = ?
    `).get(sessionId) as { ts: number | null };

    const unverified = db.prepare(`
      SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
      FROM events
      WHERE session_id = ?
        AND tool IN ('Edit', 'Write', 'MultiEdit')
        AND timestamp > ?
    `).get(sessionId, lastVerifyTime?.ts || 0) as { count: number };

    if (unverified.count > 0) {
      parts.push(`${unverified.count} unverified`);
    }

    // Loop warnings (current session only, files read 3+ times)
    const loops = db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT json_extract(input_json, '$.file_path') as file_path
        FROM events
        WHERE session_id = ?
          AND tool IN ('Read', 'View')
          AND json_extract(input_json, '$.file_path') IS NOT NULL
        GROUP BY file_path
        HAVING COUNT(*) >= 3
      )
    `).get(sessionId) as { count: number };

    if (loops.count > 0) {
      parts.push(`${loops.count} loop warning${loops.count > 1 ? 's' : ''}`);
    }

    // Recent quality failures (current session)
    const qualityFailures = getQualityEvents({ onlyFailures: true });
    if (qualityFailures.length > 0) {
      const failureCounts = new Map<string, number>();
      let hasRegression = false;

      for (const failure of qualityFailures) {
        failureCounts.set(failure.checkName, (failureCounts.get(failure.checkName) || 0) + 1);
        if (failure.isRegression) {
          hasRegression = true;
        }
      }

      const topFailures = Array.from(failureCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name, count]) => `${name} (${count}x)`)
        .join(', ');

      const agentHint = hasRegression ? 'regression-fixer' : 'quality-guard';
      console.log(`\x1b[2m○ wink · quality: ${topFailures} · try ${agentHint}\x1b[0m`);
    }

    // Check for agent summary from last Task
    const summaryPath = path.join(process.cwd(), '.wink', 'agent-summary.txt');
    if (fs.existsSync(summaryPath)) {
      const summary = fs.readFileSync(summaryPath, 'utf8').trim();
      fs.unlinkSync(summaryPath);
      if (summary) {
        console.log(`\x1b[33m${summary}\x1b[0m`);
      }
    }

    // Context hygiene warning (only show if significant waste)
    const hygiene = analyzeContextHygiene(sessionId);
    const hygieneWarning = formatHygieneWarning(hygiene);
    if (hygieneWarning) {
      console.log(`\x1b[33m${hygieneWarning}\x1b[0m`);
    }

    // Output status line
    if (parts.length > 0) {
      console.log(`\x1b[2m○ wink · ${parts.join(' · ')}\x1b[0m`);
    }

  } catch {
    process.exit(0);
  }
}

void main();
