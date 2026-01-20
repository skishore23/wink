import * as path from 'path';
import * as fs from 'fs';

export interface ISecurityConfig {
  // Paths that should never be read or analyzed
  blockedPaths: string[];
  // File patterns that should be ignored
  ignoredPatterns: RegExp[];
  // Maximum file size to analyze (in bytes)
  maxFileSize: number;
  // Sensitive data patterns to check for
  sensitivePatterns: RegExp[];
}

export class SecurityManager {
  private static readonly DEFAULT_CONFIG: ISecurityConfig = {
    blockedPaths: [
      '.env',
      '.env.local',
      '.env.production',
      'secrets',
      'credentials',
      '.ssh',
      '.gnupg',
      '.aws',
      '.gcloud'
    ],
    ignoredPatterns: [
      /\.pem$/,
      /\.key$/,
      /\.cert$/,
      /\.p12$/,
      /\.pfx$/,
      /private.*key/i,
      /secret/i,
      /password/i,
      /token/i,
      /api.*key/i
    ],
    maxFileSize: 1024 * 1024 * 5, // 5MB
    sensitivePatterns: [
      // AWS keys
      /AKIA[0-9A-Z]{16}/,
      // Private keys
      /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
      // API tokens (generic pattern)
      /["']?api[_-]?key["']?\s*[:=]\s*["'][a-zA-Z0-9_-]{20,}["']/i,
      // Database URLs with passwords
      /(?:mongodb|postgres|mysql):\/\/[^:]+:[^@]+@/,
      // JWT tokens
      /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/
    ]
  };
  
  static isFileSafe(filePath: string): { safe: boolean; reason?: string } {
    const config = this.DEFAULT_CONFIG;
    const fileName = path.basename(filePath);
    
    // Check blocked paths
    for (const blocked of config.blockedPaths) {
      if (filePath.includes(blocked)) {
        return { safe: false, reason: `File path contains blocked pattern: ${blocked}` };
      }
    }
    
    // Check ignored patterns
    for (const pattern of config.ignoredPatterns) {
      if (pattern.test(fileName) || pattern.test(filePath)) {
        return { safe: false, reason: `File matches sensitive pattern` };
      }
    }
    
    // Check file size
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > config.maxFileSize) {
        return { safe: false, reason: `File too large (${Math.round(stats.size / 1024 / 1024)}MB)` };
      }
    } catch {
      // File doesn't exist yet, that's OK
    }
    
    return { safe: true };
  }
  
  static checkContentForSensitiveData(content: string): { hasSensitiveData: boolean; matches: string[] } {
    const config = this.DEFAULT_CONFIG;
    const matches: string[] = [];
    
    for (const pattern of config.sensitivePatterns) {
      const found = content.match(pattern);
      if (found) {
        // Don't include the actual sensitive data in the match report
        matches.push(`Potential sensitive data matching pattern: ${pattern.source.substring(0, 20)}...`);
      }
    }
    
    return {
      hasSensitiveData: matches.length > 0,
      matches
    };
  }
  
  static getSecurityReport(): string {
    return `
════════════════════════════════════════════════════════════
🔒 WINK SECURITY CONFIGURATION
════════════════════════════════════════════════════════════

Blocked Paths:
${this.DEFAULT_CONFIG.blockedPaths.map(p => `  • ${p}`).join('\n')}

Sensitive File Patterns:
  • Private keys (.pem, .key, .cert)
  • Environment files (.env*)
  • Files containing "secret", "password", "token", "api key"

Content Scanning:
  • AWS access keys
  • Private RSA/SSH keys
  • API tokens and keys
  • Database connection strings with passwords
  • JWT tokens

Max File Size: ${Math.round(this.DEFAULT_CONFIG.maxFileSize / 1024 / 1024)}MB

════════════════════════════════════════════════════════════`;
  }
}