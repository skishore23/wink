#!/usr/bin/env node

import {
  getEvidenceFor,
  getMode,
  getDb,
  getCurrentSessionId,
  updateMetric,
  logAgentSpawn,
  getSessionReadCount,
  getSessionErrorCount
} from '../core/storage';
import { getConfig } from '../core/config';
import * as path from 'path';
import { readStdin } from '../core/hookRunner';
import { SecurityManager } from '../core/security';

interface PreToolUseInput {
  tool_name: string;
  tool_input: Record<string, any>;
}

interface PreToolUseOutput {
  decision: "approve" | "block";
  reason?: string;
}

function extractTargetFile(toolInput: Record<string, any>): string | null {
  if (toolInput.file_path) {
    return toolInput.file_path as string;
  }
  if (toolInput.path) {
    return toolInput.path as string;
  }
  if (toolInput.edits && Array.isArray(toolInput.edits) && toolInput.edits.length > 0) {
    return toolInput.file_path || toolInput.path || null;
  }
  return null;
}

async function main() {
  try {
    const inputData = await readStdin();
    const input: PreToolUseInput = JSON.parse(inputData);

    let output: PreToolUseOutput = { decision: "approve" };

    // Check what type of tool this is
    const toolName = input.tool_name;

    if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
      // Edit tools: check evidence
      output = await checkEditEvidence(input);
    } else if (['Read', 'View'].includes(toolName)) {
      // Read tools: check for loop blocking
      output = await checkReadLoop(input);
    } else if (toolName === 'Grep') {
      // Search tools: check for search loop blocking
      output = await checkSearchLoop(input);
    } else if (toolName === 'Task') {
      // Agent spawn: capture baselines for effectiveness tracking
      await captureAgentBaselines(input);
    }

    console.log(JSON.stringify(output));
  } catch {
    console.log(JSON.stringify({ decision: "approve" }));
    process.exit(0);
  }
}

async function checkReadLoop(input: PreToolUseInput): Promise<PreToolUseOutput> {
  const config = await getConfig();

  if (!config.loopBlocking?.enabled) {
    return { decision: "approve" };
  }

  const filePath = extractTargetFile(input.tool_input);
  if (!filePath) {
    return { decision: "approve" };
  }

  const db = getDb();
  const sessionId = getCurrentSessionId();
  const threshold = config.loopBlocking.readThreshold || 3;

  // Count previous reads of this file in current session
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ?
      AND tool IN ('Read', 'View')
      AND json_extract(input_json, '$.file_path') = ?
  `).get(sessionId, filePath) as { count: number };

  if (result.count >= threshold) {
    updateMetric('loop_detections');
    const fileName = path.basename(filePath);
    return {
      decision: "block",
      reason: [
        `🔄 Loop blocked: You've already read "${fileName}" ${result.count} times.`,
        "",
        "You have the information. Instead of re-reading:",
        "  • Make the edit you need",
        "  • Or use a context-keeper agent to cache this file",
        "  • Or move on to a different task",
        "",
        "If you truly need to re-read, ask the user to increase loopBlocking.readThreshold in config."
      ].join('\n')
    };
  }

  return { decision: "approve" };
}

async function checkSearchLoop(input: PreToolUseInput): Promise<PreToolUseOutput> {
  const config = await getConfig();

  if (!config.loopBlocking?.enabled) {
    return { decision: "approve" };
  }

  const pattern = input.tool_input.pattern as string;
  if (!pattern) {
    return { decision: "approve" };
  }

  const db = getDb();
  const sessionId = getCurrentSessionId();
  const threshold = config.loopBlocking.searchThreshold || 2;

  // Count previous searches with this pattern in current session
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ?
      AND tool = 'Grep'
      AND json_extract(input_json, '$.pattern') = ?
  `).get(sessionId, pattern) as { count: number };

  if (result.count >= threshold) {
    updateMetric('loop_detections');
    return {
      decision: "block",
      reason: [
        `🔄 Loop blocked: You've already searched for "${pattern}" ${result.count} times.`,
        "",
        "The results won't change. Use what you already found.",
        "",
        "If you need different results, try:",
        "  • A different search pattern",
        "  • Searching in a different directory",
        "  • Using Glob for file names instead of Grep for content"
      ].join('\n')
    };
  }

  return { decision: "approve" };
}

async function checkEditEvidence(input: PreToolUseInput): Promise<PreToolUseOutput> {
  const mode = getMode();

  if (mode === 'off') {
    return { decision: "approve" };
  }

  const targetFile = extractTargetFile(input.tool_input);
  if (!targetFile) {
    return { decision: "approve" };
  }

  // Security check first
  const securityCheck = SecurityManager.isFileSafe(targetFile);
  if (!securityCheck.safe) {
    return {
      decision: "block",
      reason: `🔒 Security: ${securityCheck.reason}\n\nThis file appears to contain sensitive information and should not be edited.`
    };
  }

  const evidence = getEvidenceFor(targetFile);
  const hasEvidence = evidence.fileWasRead || evidence.fileWasGrepped;

  if (hasEvidence) {
    return { decision: "approve" };
  }

  if (mode === 'block') {
    return {
      decision: "block",
      reason: formatBlockReason(targetFile)
    };
  }

  // Warn mode
  console.error(`⚠️  Editing ${path.basename(targetFile)} without reading it first. Consider: Read("${targetFile}")`);
  return { decision: "approve" };
}

function formatBlockReason(file: string): string {
  return [
    `🛑 Cannot edit ${path.basename(file)} - no evidence of reading it.`,
    "",
    "To edit this file, first:",
    `  • Read("${file}") - to understand the code`,
    `  • Or search for it: Grep("pattern", "${path.dirname(file)}")`,
    "",
    "Then retry the edit."
  ].join('\n');
}

/**
 * Capture baselines when an agent (Task tool) is spawned
 * This allows us to measure effectiveness by comparing before/after metrics
 */
async function captureAgentBaselines(input: PreToolUseInput): Promise<void> {
  try {
    // Extract agent info from tool_input
    const description = input.tool_input.description as string || '';
    const subagentType = input.tool_input.subagent_type as string || 'general';
    const prompt = input.tool_input.prompt as string || '';

    // Determine agent type from subagent_type
    let agentType = 'general';
    if (subagentType) {
      if (subagentType.includes('expert') || subagentType.includes('Explore')) {
        agentType = 'folder-expert';
      } else if (subagentType.includes('Plan')) {
        agentType = 'context-keeper';
      } else if (subagentType.toLowerCase().includes('test') || subagentType.toLowerCase().includes('lint')) {
        agentType = 'quality-guard';
      } else {
        agentType = subagentType.toLowerCase().replace(/[^a-z-]/g, '-');
      }
    }

    const agentName = description || `${agentType}-agent`;

    // Capture current metrics as baselines BEFORE agent runs
    const readsAtSpawn = getSessionReadCount();
    const errorsAtSpawn = getSessionErrorCount();

    // Log the agent spawn with baselines
    logAgentSpawn(
      {
        agentName,
        agentType,
        triggerContext: prompt.slice(0, 200)
      },
      {
        readsAtSpawn,
        errorsAtSpawn
      }
    );
  } catch {
    // Silently fail - don't break the hook
  }
}

if (import.meta.main) {
  void main();
}
