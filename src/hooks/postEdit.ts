#!/usr/bin/env node

import * as path from 'path';
import {
  readHookInput,
  outputEmpty,
  withErrorHandling
} from './utils';
import { ActivityReporter } from '../core/activityReporter';
import { logEvent } from '../core/storage';

interface PostEditInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

async function main() {
  await withErrorHandling(async () => {
    const hookInput = await readHookInput<PostEditInput>();
    const { tool_name, tool_input } = hookInput;

    // Only process write/edit operations
    if (!['Write', 'Edit', 'MultiEdit'].includes(tool_name)) {
      outputEmpty();
      return;
    }

    // Extract file path
    let filePath: string | undefined;
    if (tool_name === 'MultiEdit' && tool_input.edits) {
      filePath = tool_input.file_path as string | undefined;
    } else {
      filePath = (tool_input.file_path || tool_input.path) as string | undefined;
    }

    if (!filePath) {
      outputEmpty();
      return;
    }

    // Log the edit event for metrics tracking (language-agnostic)
    await logEvent({
      tool: tool_name,
      action: undefined,
      input: tool_input,
      output_summary: `Edited ${path.basename(filePath)}`,
      success: true,
      duration_ms: 0,
      timestamp: Date.now()
    });

    // Show file activity (language-agnostic)
    ActivityReporter.reportFileActivity('edit', path.basename(filePath));

    // No per-edit verification - use /verify for full checks
    // This keeps postEdit fast and language-agnostic
    outputEmpty();
  });
}

void main();