/**
 * Wink initialization and permission checks
 *
 * Ensures .wink/ directory exists and is writable before operations
 */

import * as fs from 'fs';
import * as path from 'path';

export interface InitResult {
  success: boolean;
  error?: string;
  winkDir: string;
  inMemoryMode: boolean;
}

/**
 * Ensure the .wink directory exists and is writable
 */
export function ensureWinkDirectory(projectRoot: string = process.cwd()): InitResult {
  const winkDir = path.join(projectRoot, '.wink');

  // Check if we can write to project root
  try {
    fs.accessSync(projectRoot, fs.constants.W_OK);
  } catch {
    return {
      success: false,
      error: `Cannot write to ${projectRoot}. Check permissions.`,
      winkDir,
      inMemoryMode: true
    };
  }

  // Try to create or access .wink directory
  try {
    if (!fs.existsSync(winkDir)) {
      fs.mkdirSync(winkDir, { recursive: true });
    }

    // Verify we can write to .wink
    const testFile = path.join(winkDir, '.write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);

    return {
      success: true,
      winkDir,
      inMemoryMode: false
    };
  } catch (err) {
    return {
      success: false,
      error: `Cannot create .wink directory: ${err instanceof Error ? err.message : String(err)}`,
      winkDir,
      inMemoryMode: true
    };
  }
}

/**
 * Initialize Wink for the current project
 * Logs warnings but doesn't fail - falls back to in-memory mode if needed
 */
export function initializeWink(projectRoot: string = process.cwd()): InitResult {
  const result = ensureWinkDirectory(projectRoot);

  if (!result.success) {
    // Log warning but don't crash - will run in limited mode
    if (process.env.WINK_DEBUG) {
      console.error(`[wink] Initialization warning: ${result.error}`);
      console.error('[wink] Running in limited mode without persistence.');
    }
  }

  return result;
}

/**
 * Check if Wink is properly initialized for a project
 */
export function isWinkInitialized(projectRoot: string = process.cwd()): boolean {
  const winkDir = path.join(projectRoot, '.wink');
  const dbPath = path.join(winkDir, 'session.db');

  return fs.existsSync(winkDir) && fs.existsSync(dbPath);
}

/**
 * Get the .wink directory path for a project
 */
export function getWinkDir(projectRoot: string = process.cwd()): string {
  return path.join(projectRoot, '.wink');
}

/**
 * Get the database path, or :memory: if initialization failed
 */
export function getDatabasePath(projectRoot: string = process.cwd()): string {
  const result = ensureWinkDirectory(projectRoot);

  if (result.inMemoryMode) {
    return ':memory:';
  }

  return path.join(result.winkDir, 'session.db');
}
