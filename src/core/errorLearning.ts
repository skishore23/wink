/**
 * Error Learning Module
 *
 * Normalizes and clusters error messages to learn patterns from data
 * instead of using hardcoded regex rules.
 */

import * as crypto from 'crypto';
import {
  findOrCreateErrorPattern,
  logErrorInstance,
  markErrorFixed,
  getTopErrorPatterns,
  ErrorPattern
} from './storage';

export interface NormalizedError {
  hash: string;
  normalized: string;
  keywords: string[];
  category: string | null;
  filePath: string | null;
}

/**
 * Normalize an error message by removing variable parts
 * This allows similar errors to be grouped together
 */
export function normalizeError(rawError: string): NormalizedError {
  let normalized = rawError;

  // Extract file path before normalization
  const filePathMatch = rawError.match(/(?:\/[\w/\-_.]+\.[a-z]+)/i);
  const filePath = filePathMatch ? filePathMatch[0] : null;

  // Remove file paths (keep extension for categorization)
  normalized = normalized.replace(/\/[\w/\-_.]+\/([^/\s]+\.[a-z]+)/gi, '<FILE>/$1');
  normalized = normalized.replace(/\/[\w/\-_.]+\.[a-z]+/gi, '<FILE>');

  // Remove line numbers
  normalized = normalized.replace(/line \d+/gi, 'line <N>');
  normalized = normalized.replace(/:\d+:\d+/g, ':<N>:<N>');
  normalized = normalized.replace(/\(\d+,\d+\)/g, '(<N>,<N>)');

  // Remove variable names in quotes
  normalized = normalized.replace(/'[^']+'/g, "'<VAR>'");
  normalized = normalized.replace(/"[^"]+"/g, '"<VAR>"');

  // Remove hex addresses
  normalized = normalized.replace(/0x[0-9a-f]+/gi, '<ADDR>');

  // Remove specific numbers
  normalized = normalized.replace(/\b\d+\b/g, '<N>');

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Extract keywords (significant words for matching)
  const keywords = extractKeywords(normalized);

  // Generate hash from sorted keywords
  const hash = generateHash(keywords.sort().join('|'));

  // Categorize based on keywords
  const category = categorizeError(keywords, rawError);

  return {
    hash,
    normalized,
    keywords,
    category,
    filePath
  };
}

/**
 * Extract significant keywords from normalized error
 */
function extractKeywords(normalized: string): string[] {
  // Common error-related words to look for
  const significantPatterns = [
    // TypeScript/JavaScript
    'type', 'property', 'argument', 'assignable', 'undefined', 'null',
    'import', 'export', 'module', 'cannot find', 'does not exist',
    'expected', 'unexpected', 'missing', 'syntax', 'parse',

    // Build errors
    'error', 'failed', 'compilation', 'build', 'compile',

    // Runtime errors
    'exception', 'throw', 'reject', 'timeout', 'crash',

    // Test errors
    'assert', 'expect', 'test', 'spec', 'fail',

    // Lint errors
    'lint', 'eslint', 'prettier', 'format', 'unused', 'deprecated'
  ];

  const words = normalized.toLowerCase().split(/\s+/);
  const keywords: string[] = [];

  for (const word of words) {
    // Skip placeholders
    if (word.includes('<') && word.includes('>')) continue;

    // Check if word matches any significant pattern
    for (const pattern of significantPatterns) {
      if (word.includes(pattern)) {
        keywords.push(pattern);
        break;
      }
    }
  }

  // Add unique keywords only
  return [...new Set(keywords)];
}

/**
 * Generate a hash for the normalized error
 */
function generateHash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 12);
}

/**
 * Categorize error based on keywords and raw text
 */
function categorizeError(keywords: string[], rawError: string): string | null {
  const lower = rawError.toLowerCase();

  // TypeScript type errors
  if (keywords.includes('type') && (keywords.includes('assignable') || keywords.includes('property'))) {
    return 'typescript-type';
  }

  // Import/module errors
  if (keywords.includes('import') || keywords.includes('module') || keywords.includes('cannot find')) {
    return 'import-module';
  }

  // Syntax errors
  if (keywords.includes('syntax') || keywords.includes('parse') || keywords.includes('unexpected')) {
    return 'syntax';
  }

  // Test failures
  if (keywords.includes('test') || keywords.includes('assert') || keywords.includes('expect')) {
    return 'test-failure';
  }

  // Lint errors
  if (keywords.includes('lint') || keywords.includes('eslint') || keywords.includes('unused')) {
    return 'lint';
  }

  // Build errors
  if (keywords.includes('build') || keywords.includes('compile') || keywords.includes('compilation')) {
    return 'build';
  }

  // Runtime errors
  if (keywords.includes('exception') || keywords.includes('throw') || lower.includes('runtime')) {
    return 'runtime';
  }

  return null;
}

/**
 * Process a raw error and store it in the learning system
 */
export function processError(rawError: string): {
  patternId: number;
  instanceId: number;
  normalized: NormalizedError;
} {
  const normalized = normalizeError(rawError);

  // Find or create the pattern
  const patternId = findOrCreateErrorPattern(
    normalized.hash,
    normalized.normalized,
    normalized.category || undefined
  );

  // Log this specific instance
  const instanceId = logErrorInstance(
    patternId,
    rawError,
    normalized.filePath || undefined
  );

  return {
    patternId,
    instanceId,
    normalized
  };
}

/**
 * Mark an error as fixed (call when a fix is successful)
 */
export function recordErrorFix(instanceId: number, agentName?: string): void {
  markErrorFixed(instanceId, agentName);
}

/**
 * Get learned error patterns for analysis
 */
export function getLearnedPatterns(limit: number = 10): ErrorPattern[] {
  return getTopErrorPatterns(limit);
}

/**
 * Suggest an agent based on error category
 */
export function suggestAgentForError(category: string | null): string | null {
  if (!category) return null;

  const suggestions: Record<string, string> = {
    'typescript-type': 'typescript-expert',
    'import-module': 'module-resolver',
    'syntax': 'syntax-fixer',
    'test-failure': 'test-specialist',
    'lint': 'lint-fixer',
    'build': 'build-expert',
    'runtime': 'debug-agent'
  };

  return suggestions[category] || null;
}

/**
 * Find similar errors based on keyword overlap
 */
export function findSimilarErrors(normalized: NormalizedError, patterns: ErrorPattern[]): ErrorPattern[] {
  const similar: Array<{ pattern: ErrorPattern; score: number }> = [];

  for (const pattern of patterns) {
    // Parse keywords from canonical form (simple approach)
    const patternKeywords = extractKeywords(pattern.canonicalForm);

    // Calculate Jaccard similarity
    const intersection = normalized.keywords.filter(k => patternKeywords.includes(k)).length;
    const union = new Set([...normalized.keywords, ...patternKeywords]).size;
    const score = union > 0 ? intersection / union : 0;

    if (score > 0.3) {
      similar.push({ pattern, score });
    }
  }

  // Sort by score descending
  similar.sort((a, b) => b.score - a.score);

  return similar.map(s => s.pattern);
}
