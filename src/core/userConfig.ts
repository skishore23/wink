import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot } from './config';

export interface IToolConfig {
  name: string;
  command: string;
  description?: string;
  runOn?: 'always' | 'edit' | 'save';
  filePatterns?: string[];
  enabled?: boolean;
}

export interface IWinkConfig {
  // Show what wink is doing
  showActivity?: boolean;
  activityPrefix?: string;
  
  // Custom tools for each language
  tools?: {
    [language: string]: IToolConfig[];
  };
  
  // Override default commands
  commands?: {
    test?: string;
    lint?: string;
    typecheck?: string;
    build?: string;
  };
  
  // Message customization
  messages?: {
    contextInjected?: string;
    checksRunning?: string;
    checksPassed?: string;
    checksFailed?: string;
  };
  
  // Feature toggles
  features?: {
    contextInjection?: boolean;
    autoRecovery?: boolean;
    helpfulnessTracking?: boolean;
    securityChecks?: boolean;
  };
}

export class UserConfigManager {
  private static configCache: IWinkConfig | null = null;
  
  static getConfig(): IWinkConfig {
    if (this.configCache) return this.configCache;
    
    const projectRoot = getProjectRoot();
    const configPaths = [
      path.join(projectRoot, '.wink.json'),
      path.join(projectRoot, '.wink/config.json'),
      path.join(projectRoot, 'wink.config.json')
    ];
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf-8');
          this.configCache = JSON.parse(content);
          return this.configCache!;
        } catch (error) {
          console.error(`Failed to parse config at ${configPath}:`, error);
        }
      }
    }
    
    // Return defaults
    return {
      showActivity: true,
      activityPrefix: '🔍 WINK:',
      features: {
        contextInjection: true,
        autoRecovery: true,
        helpfulnessTracking: true,
        securityChecks: true
      },
      messages: {
        contextInjected: 'Context enriched with session state',
        checksRunning: 'Running project checks...',
        checksPassed: 'All checks passed',
        checksFailed: 'Some checks failed'
      }
    };
  }
  
  static getToolsForLanguage(language: string): IToolConfig[] {
    const config = this.getConfig();
    return config.tools?.[language] || [];
  }
  
  static shouldShowActivity(): boolean {
    return this.getConfig().showActivity !== false;
  }
  
  static getActivityPrefix(): string {
    return this.getConfig().activityPrefix || '🔍 WINK:';
  }
  
  static createExampleConfig(): string {
    const example: IWinkConfig = {
      showActivity: true,
      activityPrefix: "🔍 WINK:",
      
      tools: {
        go: [
          {
            name: "security",
            command: "gosec ./...",
            description: "Run security analysis",
            runOn: "edit",
            filePatterns: ["*.go"]
          },
          {
            name: "deadcode", 
            command: "deadcode ./...",
            description: "Find unused code",
            runOn: "save"
          }
        ],
        typescript: [
          {
            name: "bundle-size",
            command: "size-limit",
            description: "Check bundle size",
            runOn: "save",
            filePatterns: ["*.ts", "*.tsx"]
          }
        ]
      },
      
      commands: {
        test: "npm test -- --coverage",
        lint: "npm run lint:strict"
      },
      
      messages: {
        contextInjected: "📊 Context enriched with session data",
        checksRunning: "⚡ Running checks...",
        checksPassed: "✅ Looking good!",
        checksFailed: "💥 Issues found"
      },
      
      features: {
        contextInjection: true,
        autoRecovery: true,
        helpfulnessTracking: true,
        securityChecks: true
      }
    };
    
    return JSON.stringify(example, null, 2);
  }
}