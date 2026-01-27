#!/usr/bin/env node

import {
  logEvent,
  getDb,
  getCurrentSessionId,
  markFileRead,
  markFileGrepped
} from '../core/storage';
import { detectLoops, shouldWarnAboutLoop } from '../core/loopDetection';
import { getConfig } from '../core/config';
import { readStdin } from '../core/hookRunner';
import { colors as c } from './utils';
import { logError } from '../core/errorLearning';

// Cache for showActivity setting
let showActivity: boolean | null = null;

async function shouldShowActivity(): Promise<boolean> {
  if (showActivity === null) {
    try {
      const config = await getConfig();
      showActivity = config.feedback?.showActivity ?? true;
    } catch {
      showActivity = true; // Default to showing activity
    }
  }
  return showActivity;
}

interface ToolResponse {
  // Bash response format
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  // Read/View response format
  type?: string;
  file?: {
    filePath?: string;
    content?: string;
  };
  // Error format
  error?: string;
}

interface PostToolUseInput {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, any>;
  tool_response: ToolResponse | string;
  tool_use_id: string;
}

// Determine success based on tool response
function isSuccessful(toolName: string, response: ToolResponse | string): boolean {
  if (typeof response === 'string') {
    // String response - check for error patterns
    return !response.toLowerCase().includes('error') &&
           !response.includes('does not exist') &&
           !response.includes('ENOENT');
  }

  // Object response
  if (response.error) return false;
  if (response.interrupted) return false;

  // For Bash, check stderr for errors (some tools write to stderr normally)
  if (toolName === 'Bash' && response.stderr) {
    const stderr = response.stderr.toLowerCase();
    if (stderr.includes('error') || stderr.includes('failed') || stderr.includes('exception')) {
      return false;
    }
  }

  return true;
}

// Extract output text from tool response
function getOutputText(response: ToolResponse | string): string {
  if (typeof response === 'string') return response;
  // Read/View tool format
  if (response.file?.content) return response.file.content;
  // Bash format
  if (response.stdout) return response.stdout;
  // Error format
  if (response.error) return response.error;
  return '';
}

interface PostToolUseOutput {
  additionalContext?: string;
}

async function main() {
  try {
    const inputData = await readStdin();
    const input: PostToolUseInput = JSON.parse(inputData);

    // Derive success and output from tool_response
    const success = isSuccessful(input.tool_name, input.tool_response);
    const outputText = getOutputText(input.tool_response);

    // Always log the event
    await logEvent({
      tool: input.tool_name,
      action: undefined,
      input: input.tool_input,
      output_summary: outputText.slice(0, 200),
      success: success,
      duration_ms: 0,
      timestamp: Date.now()
    });

    // Track errors for analysis (if tool failed)
    if (!success && outputText) {
      trackErrorForAnalysis(input.tool_name, outputText);
    }

    // Balanced feedback for significant operations (if enabled)
    const significantTools = ['Edit', 'Write', 'MultiEdit'];
    if (significantTools.includes(input.tool_name) && await shouldShowActivity()) {
      const filePath = input.tool_input.file_path as string || '';
      const fileName = filePath.split('/').pop() || input.tool_name.toLowerCase();
      process.stderr.write(`${c.cyan}● wink · edit: ${fileName}${c.reset}\n`);
    }

    let additionalContext: string | undefined;

    // Detect tool type from tool_name
    const toolName = input.tool_name;

    if (['Read', 'View'].includes(toolName)) {
      await handleFileRead(input);
      // Check for loops after file reads
      const loopWarning = detectLoops();
      if (loopWarning && shouldWarnAboutLoop(loopWarning)) {
        additionalContext = loopWarning.message;
      }
    } else if (['Grep', 'Glob'].includes(toolName)) {
      await handleSearchComplete(input, success, outputText);
      // Check for loops after searches
      const searchLoopWarning = detectLoops();
      if (searchLoopWarning && shouldWarnAboutLoop(searchLoopWarning)) {
        additionalContext = searchLoopWarning.message;
      }
    } else if (toolName === 'Task') {
      // Agent completed - save summary for context
      await saveAgentSummary();
    }

    const output: PostToolUseOutput = {};
    if (additionalContext) {
      output.additionalContext = additionalContext;
    }

    console.log(JSON.stringify(output));
  } catch (err) {
    // Log error but don't break Claude's flow
    console.error(JSON.stringify({
      error: `PostToolUse error: ${err}`
    }));
    process.exit(1);
  }
}

async function handleFileRead(input: PostToolUseInput) {
  const filePath = input.tool_input.file_path as string;
  if (filePath) {
    // Track successful reads as evidence
    markFileRead(filePath, {
      lines: input.tool_input.lines,
      success: true
    });

    // Balanced feedback - subtle wink indicator (if enabled)
    if (await shouldShowActivity()) {
      const fileName = filePath.split('/').pop() || filePath;
      process.stderr.write(`${c.dim}● wink · read: ${fileName}${c.reset}\n`);
    }
  }
}

async function handleSearchComplete(input: PostToolUseInput, success: boolean, outputText: string) {
  if (input.tool_name === 'Grep' && success && outputText) {
    // Parse grep results to find matched files
    const pattern = input.tool_input.pattern as string;
    const output = outputText;

    // Simple parser for grep output (files_with_matches mode)
    const lines = output.split('\n').filter(l => l.trim());
    let trackedCount = 0;

    for (const line of lines) {
      // Grep output format varies, but file paths are usually at the start
      const match = line.match(/^([^:]+):/);
      if (match) {
        const filePath = match[1];
        markFileGrepped(filePath, pattern);
        trackedCount++;
      } else if (line.includes('/') && !line.includes(':')) {
        // Might be a plain file path
        markFileGrepped(line.trim(), pattern);
        trackedCount++;
      }
    }

    // Balanced feedback - subtle wink indicator (if enabled)
    if (trackedCount > 0 && await shouldShowActivity()) {
      process.stderr.write(`${c.dim}● wink · grep: ${trackedCount} file${trackedCount > 1 ? 's' : ''}${c.reset}\n`);
    }
  }
}

/**
 * Track errors for Claude to analyze
 */
function trackErrorForAnalysis(toolName: string, errorText: string): void {
  try {
    // Only process substantial error messages
    if (errorText.length < 10) return;

    // Log the error for analysis
    logError(errorText);
  } catch {
    // Silently fail - don't break the hook
  }
}

async function saveAgentSummary(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  try {
    const db = getDb();
    const sessionId = getCurrentSessionId();

    // Get activity from last 5 minutes (typical agent run time)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    // Get recent decisions (stops, blocks, warnings)
    const decisions = db.prepare(`
      SELECT decision_type, decision, COUNT(*) as count
      FROM decision_log
      WHERE session_id = ? AND timestamp > ?
      GROUP BY decision_type, decision
    `).all(sessionId, fiveMinAgo) as Array<{decision_type: string; decision: string; count: number}>;

    // Get recent events summary
    const events = db.prepare(`
      SELECT tool, COUNT(*) as count
      FROM events
      WHERE session_id = ? AND timestamp > ?
      GROUP BY tool
      ORDER BY count DESC
      LIMIT 5
    `).all(sessionId, fiveMinAgo) as Array<{tool: string; count: number}>;

    // Get loop detections
    const loops = db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE session_id = ? AND timestamp > ?
        AND output_summary LIKE '%loop%'
    `).get(sessionId, fiveMinAgo) as {count: number};

    // Build summary
    const parts: string[] = [];

    // Blocks/warnings
    const stopBlocks = decisions.filter(d => d.decision_type === 'stop_gate' && d.decision === 'block');
    const editWarns = decisions.filter(d => d.decision_type === 'edit_check' && d.decision === 'warn');

    if (stopBlocks.length > 0) {
      parts.push(`${stopBlocks.reduce((a, b) => a + b.count, 0)} stop blocks`);
    }
    if (editWarns.length > 0) {
      parts.push(`${editWarns.reduce((a, b) => a + b.count, 0)} edit warnings`);
    }
    if (loops.count > 0) {
      parts.push(`${loops.count} loops`);
    }

    // Activity summary
    const edits = events.filter(e => ['Edit', 'Write', 'MultiEdit'].includes(e.tool));
    const reads = events.filter(e => ['Read', 'View'].includes(e.tool));

    if (edits.length > 0 || reads.length > 0) {
      const editCount = edits.reduce((a, b) => a + b.count, 0);
      const readCount = reads.reduce((a, b) => a + b.count, 0);
      parts.push(`${editCount} edits, ${readCount} reads`);
    }

    if (parts.length === 0) {
      return;
    }

    // Build summary string
    const hasIssues = stopBlocks.length > 0 || editWarns.length > 0 || loops.count > 0;
    const icon = hasIssues ? '⚡' : '✓';
    const summary = `${icon} agent · ${parts.join(' · ')}`;

    // Save to file for UserPromptSubmit to read
    const summaryPath = path.join(process.cwd(), '.wink', 'agent-summary.txt');
    fs.writeFileSync(summaryPath, summary);
  } catch {
    // Silently fail
  }
}

if (import.meta.main) {
  void main();
}
