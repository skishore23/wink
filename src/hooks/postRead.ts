#!/usr/bin/env node

import * as path from 'path';
import {
  readHookInput,
  outputHookResult,
  outputEmpty,
  withErrorHandling,
  logDebugContext
} from './utils';
import { getDb, getCurrentSessionId, logEvent } from '../core/storage';

interface PostReadInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

async function main() {
  await withErrorHandling(async () => {
    const hookInput = await readHookInput<PostReadInput>();
    const { tool_name, tool_input } = hookInput;

    // Log the read/search event for metrics tracking
    const filePath = String(tool_input.file_path || tool_input.path || tool_input.pattern || '');
    await logEvent({
      tool: tool_name,
      action: undefined,
      input: tool_input,
      output_summary: `${tool_name}: ${path.basename(filePath) || filePath}`,
      success: true,
      duration_ms: 0,
      timestamp: Date.now()
    });

    const db = getDb();
    const sessionId = getCurrentSessionId();

    let count = 0;
    let value = '';
    let warningThreshold = 3;

    // Count reads from database (current session)
    if (['Read', 'View'].includes(tool_name)) {
      const filePathValue = String(tool_input.file_path || tool_input.path || '');
      if (filePathValue) {
        value = filePathValue;
        const result = db.prepare(`
          SELECT COUNT(*) as count FROM events
          WHERE session_id = ?
            AND tool IN ('Read', 'View')
            AND json_extract(input_json, '$.file_path') = ?
        `).get(sessionId, filePathValue) as { count: number };
        count = result.count;
        warningThreshold = 3;
      }
    }
    // Count searches from database (current session)
    else if (tool_name === 'Grep') {
      const patternValue = String(tool_input.pattern || '');
      if (patternValue) {
        value = patternValue;
        const result = db.prepare(`
          SELECT COUNT(*) as count FROM events
          WHERE session_id = ?
            AND tool = 'Grep'
            AND json_extract(input_json, '$.pattern') = ?
        `).get(sessionId, patternValue) as { count: number };
        count = result.count;
        warningThreshold = 2;
      }
    }

    // Build message with loop warning
    const messages: string[] = [];

    if (count >= warningThreshold) {
      if (tool_name === 'Grep') {
        messages.push(`! wink · searched '${value}' ${count}x - results won't change`);
      } else {
        messages.push(`! wink · read '${path.basename(value)}' ${count}x - consider making edits`);
      }
    }

    // Output if we have any messages
    if (messages.length > 0) {
      const fullMessage = messages.join('\n');
      outputHookResult({ additionalContext: fullMessage });
      await logDebugContext('PostRead', fullMessage);
    } else {
      outputEmpty();
    }
  });
}

void main();
