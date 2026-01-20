#!/usr/bin/env node

import { execSync } from 'child_process';
import * as path from 'path';
import { getProjectRoot } from '../core/config';
import {
  readHookInput,
  outputHookResult,
  outputEmpty,
  withErrorHandling,
  logDebugContext,
  colors as c
} from './utils';
import { ProjectDetector } from '../core/projectDetector';
import { ActivityReporter } from '../core/activityReporter';
import { UserConfigManager } from '../core/userConfig';
import { logEvent } from '../core/storage';

interface VerificationResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runFastVerify(projectRoot: string, editedFile: string): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const fileName = path.basename(editedFile);

  // Use ProjectDetector to get appropriate commands
  const projectConfig = ProjectDetector.detect(projectRoot);

  // Only check TypeScript/JavaScript files
  const isCheckableFile = /\.(ts|tsx|js|jsx)$/.test(editedFile);
  if (!isCheckableFile) {
    return results;
  }

  // Run typecheck on the specific file (faster than whole project)
  if (projectConfig.typecheckCommand && editedFile.endsWith('.ts')) {
    try {
      // Use tsc to check just this file's errors
      const output = execSync(`npx tsc --noEmit 2>&1 | grep -E "^${editedFile.replace(/\//g, '\\/')}:" | head -3`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 30000,
        shell: '/bin/bash'
      });
      const errors = output.toString().trim();
      if (errors) {
        const firstError = errors.split('\n')[0] || 'type error';
        results.push({ name: 'typecheck', passed: false, error: firstError.substring(0, 80) });
        process.stderr.write(`${c.red}✗ wink · typecheck: ${fileName}${c.reset}\n`);
      } else {
        results.push({ name: 'typecheck', passed: true });
        process.stderr.write(`${c.green}✓ wink · typecheck: ${fileName}${c.reset}\n`);
      }
    } catch {
      // grep returns exit 1 when no matches = no errors in this file
      results.push({ name: 'typecheck', passed: true });
      process.stderr.write(`${c.green}✓ wink · typecheck: ${fileName}${c.reset}\n`);
    }
  }

  // Run lint on just the edited file (much faster!)
  if (projectConfig.lintCommand) {
    try {
      execSync(`npx eslint "${editedFile}"`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10000
      });
      results.push({ name: 'lint', passed: true });
      process.stderr.write(`${c.green}✓ wink · lint: ${fileName}${c.reset}\n`);
    } catch (error: any) {
      const output = error.stdout?.toString() || '';
      const errorLine = output.split('\n').find((l: string) => l.includes('error')) || 'lint error';
      results.push({ name: 'lint', passed: false, error: errorLine.substring(0, 60) });
      process.stderr.write(`${c.red}✗ wink · lint: ${fileName}${c.reset}\n`);
    }
  }

  return results;
}

async function main() {
  await withErrorHandling(async () => {
    const hookInput = await readHookInput();
    const { tool_name, tool_input } = hookInput;
    
    // Only process write/edit operations
    if (!['Write', 'Edit', 'MultiEdit'].includes(tool_name)) {
      outputEmpty();
      return;
    }
    
    // Extract file path
    let filePath: string | undefined;
    if (tool_name === 'MultiEdit' && tool_input.edits) {
      filePath = tool_input.file_path;
    } else {
      filePath = tool_input.file_path || tool_input.path;
    }
    
    if (!filePath) {
      outputEmpty();
      return;
    }

    // Log the edit event for metrics tracking
    await logEvent({
      tool: tool_name,
      action: undefined,
      input: tool_input,
      output_summary: `Edited ${path.basename(filePath)}`,
      success: true,
      duration_ms: 0,
      timestamp: Date.now()
    });

    const projectRoot = getProjectRoot();

    // Show file activity
    ActivityReporter.reportFileActivity('edit', path.basename(filePath));
    
    // Run fast verification
    const checkNames: string[] = [];
    const projectConfig = ProjectDetector.detect(projectRoot);
    if (projectConfig.typecheckCommand) checkNames.push('typecheck');
    if (projectConfig.lintCommand) checkNames.push('lint');
    
    // Add custom tools
    const customTools = UserConfigManager.getToolsForLanguage(projectConfig.type);
    const editTools = customTools.filter(t => t.runOn === 'edit' || t.runOn === 'always');
    checkNames.push(...editTools.map(t => t.name));
    
    // Report checks starting (side effect for logging)
    if (checkNames.length > 0) {
      ActivityReporter.reportChecksStarting(checkNames);
    }
    
    const verifyResults = await runFastVerify(projectRoot, filePath);
    
    // Run custom tools
    for (const tool of editTools) {
      if (tool.enabled !== false) {
        ActivityReporter.reportToolRunning(tool.name, tool.description);
        try {
          execSync(tool.command, {
            cwd: projectRoot,
            stdio: 'pipe',
            timeout: 30000
          });
          verifyResults.push({ name: tool.name, passed: true });
        } catch {
          verifyResults.push({ 
            name: tool.name, 
            passed: false, 
            error: 'check failed'
          });
        }
      }
    }
    
    // Build feedback for Claude - modern, subtle format
    if (verifyResults.length > 0) {
      const failures = verifyResults.filter(r => !r.passed);
      const fileName = path.basename(filePath);

      let feedback = '';

      if (failures.length > 0) {
        // Clean failure format
        feedback = ActivityReporter.reportVerificationFailure(
          fileName,
          failures.map(f => ({ name: f.name, error: f.error }))
        );
      } else {
        feedback = ActivityReporter.reportVerificationSuccess(fileName);
      }

      outputHookResult({ additionalContext: feedback });

      // Debug logging
      await logDebugContext('PostEdit', feedback);
    } else {
      outputEmpty();
    }
  });
}

main();