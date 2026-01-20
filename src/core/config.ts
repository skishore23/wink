import * as fs from 'fs';
import * as path from 'path';
import { ProjectDetector } from './projectDetector';

export interface Config {
  enabled: boolean;
  mode: 'off' | 'warn' | 'block';
  stopDiscipline: {
    enabled: boolean;
    requireVerify: boolean;
  };
  autoVerify: {
    enabled: boolean;
    showStatus: boolean;
    timeout: number;
  };
  verifiers: {
    typecheck?: string;
    lint?: string;
    test?: string;
    build?: string;
    security?: string;
  };
  evidenceDecay: {
    enabled: boolean;
    freshMinutes: number;
    expireMinutes: number;
  };
  verifyTimeout: number;
  fastVerifyTimeout: number;
  feedback: {
    showActivity: boolean;
    colors: boolean;
    prefix: string;
  };
  features: {
    contextInjection: boolean;
    loopDetection: boolean;
    autoRecovery: boolean;
    helpfulnessTracking: boolean;
    securityChecks: boolean;
    fileSpecificChecks: boolean;
  };
  loopBlocking: {
    enabled: boolean;
    readThreshold: number;   // Block after N reads of same file
    searchThreshold: number; // Block after N identical searches
  };
  tools: {
    [language: string]: Array<{
      name: string;
      command: string;
      description?: string;
      runOn?: 'always' | 'edit' | 'save';
      filePatterns?: string[];
      enabled?: boolean;
    }>;
  };
  messages: {
    verified: string;
    failing: string;
    unverified: string;
  };
}

const DEFAULT_CONFIG: Config = {
  enabled: true,
  mode: 'warn',
  stopDiscipline: {
    enabled: true,
    requireVerify: true
  },
  autoVerify: {
    enabled: true,
    showStatus: true,
    timeout: 30
  },
  verifiers: {
    // Will be auto-detected or user-configured
  },
  evidenceDecay: {
    enabled: false,
    freshMinutes: 5,
    expireMinutes: 15
  },
  verifyTimeout: 120,
  fastVerifyTimeout: 30,
  feedback: {
    showActivity: true,
    colors: true,
    prefix: 'wink'
  },
  features: {
    contextInjection: true,
    loopDetection: true,
    autoRecovery: true,
    helpfulnessTracking: true,
    securityChecks: true,
    fileSpecificChecks: true
  },
  loopBlocking: {
    enabled: true,
    readThreshold: 3,    // Block after 3 reads of same file
    searchThreshold: 2   // Block after 2 identical searches
  },
  tools: {},
  messages: {
    verified: '✓ verified',
    failing: '✗ failing',
    unverified: 'unverified edits'
  }
};

let cachedConfig: Config | null = null;

export async function getConfig(): Promise<Config> {
  if (cachedConfig) return cachedConfig;
  
  const configPath = path.join(process.cwd(), '.wink', 'config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const userConfig = JSON.parse(content);
      cachedConfig = { ...DEFAULT_CONFIG, ...userConfig };
    } else {
      // Create default config
      cachedConfig = { ...DEFAULT_CONFIG };
      await saveConfig(cachedConfig);
    }
  } catch (error) {
    console.error('Error loading config:', error);
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  
  return cachedConfig!; // We know it's not null after the try-catch
}

export async function saveConfig(config: Config): Promise<void> {
  const configDir = path.join(process.cwd(), '.wink');
  const configPath = path.join(configDir, 'config.json');
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

export function getProjectRoot(): string {
  return process.cwd();
}

export function detectVerifiers(): Partial<Config['verifiers']> {
  const projectRoot = process.cwd();
  const project = ProjectDetector.detect(projectRoot);
  const verifiers: Partial<Config['verifiers']> = {};

  // Use project detector for any project type
  if (project.type !== 'unknown') {
    if (project.typecheckCommand) {
      verifiers.typecheck = project.typecheckCommand;
    }
    if (project.lintCommand) {
      verifiers.lint = project.lintCommand;
    }
    if (project.testCommand) {
      verifiers.test = project.testCommand;
    }
    if (project.buildCommand) {
      verifiers.build = project.buildCommand;
    }
    if (project.securityCommand) {
      verifiers.security = project.securityCommand;
    }
    return verifiers;
  }

  // Fallback: try to detect from package.json for Node projects
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const scripts = packageJson.scripts || {};

      // Common script names for typecheck
      const typecheckNames = ['typecheck', 'type-check', 'tsc', 'check-types'];
      for (const name of typecheckNames) {
        if (scripts[name]) {
          verifiers.typecheck = `npm run ${name}`;
          break;
        }
      }

      // Common script names for lint
      const lintNames = ['lint', 'eslint', 'tslint'];
      for (const name of lintNames) {
        if (scripts[name]) {
          verifiers.lint = `npm run ${name}`;
          break;
        }
      }

      // Test script
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        verifiers.test = 'npm test';
      }
    } catch {
      // Ignore parse errors
    }
  }

  return verifiers;
}