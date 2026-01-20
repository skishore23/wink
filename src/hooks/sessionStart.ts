#!/usr/bin/env node

import { logEvent, startNewSession } from '../core/storage.js';

interface SessionStartHookInput {
  sessionId: string;
  workingDirectory: string;
}

async function main() {
  try {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else {
        chunks.push(Buffer.from(chunk));
      }
    });

    process.stdin.on('end', async () => {
      try {
        const input = Buffer.concat(chunks).toString();
        const data: SessionStartHookInput = JSON.parse(input);

        // Start a new session when Claude Code starts
        startNewSession();

        // Log session start event
        logEvent({
          tool: 'SessionStart',
          action: 'start',
          input: data,
          success: true,
          timestamp: Date.now()
        });

        // Exit successfully
        process.exit(0);
      } catch (error) {
        // Log error but exit gracefully
        console.error('Session start error:', error);
        process.exit(0);
      }
    });
  } catch {
    // Exit gracefully on any error
    process.exit(0);
  }
}

main();