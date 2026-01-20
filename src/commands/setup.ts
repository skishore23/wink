#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { getDb, startNewSession } from '../core/storage';
import { getConfig, saveConfig, detectVerifiers } from '../core/config';
import { ProjectDetector } from '../core/projectDetector';

async function main() {
  const cwd = process.cwd();
  const winkDir = path.join(cwd, '.wink');

  console.log('🔧 Wink Setup\n');

  // Step 1: Create .wink directory
  if (!fs.existsSync(winkDir)) {
    fs.mkdirSync(winkDir, { recursive: true });
    console.log('✅ Created .wink/ directory');
  } else {
    console.log('📁 .wink/ directory exists');
  }

  // Step 2: Initialize database
  const dbPath = path.join(winkDir, 'session.db');
  const dbExists = fs.existsSync(dbPath);

  getDb(); // This creates the database and schema

  if (!dbExists) {
    console.log('✅ Created session.db database');
  } else {
    console.log('📁 session.db exists');
  }

  // Step 3: Start fresh session
  const sessionId = startNewSession();
  console.log(`✅ Started new session: ${sessionId.slice(0, 20)}...`);

  // Step 4: Detect project type
  const project = ProjectDetector.detect(cwd);
  console.log(`\n📦 Detected project type: ${project.type}`);

  // Step 5: Create/update config
  const configPath = path.join(winkDir, 'config.json');
  const config = await getConfig();

  // Auto-detect verifiers
  const detectedVerifiers = detectVerifiers();
  config.verifiers = { ...config.verifiers, ...detectedVerifiers };

  await saveConfig(config);

  console.log('\n📋 Configuration:');
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Stop discipline: ${config.stopDiscipline.enabled ? 'enabled' : 'disabled'}`);
  console.log(`  Loop blocking: ${config.loopBlocking?.enabled ? 'enabled' : 'disabled'}`);
  if (config.loopBlocking?.enabled) {
    console.log(`    Read threshold: ${config.loopBlocking.readThreshold}`);
    console.log(`    Search threshold: ${config.loopBlocking.searchThreshold}`);
  }

  console.log('\n🔍 Verifiers:');
  if (config.verifiers.typecheck) {
    console.log(`  Typecheck: ${config.verifiers.typecheck}`);
  }
  if (config.verifiers.lint) {
    console.log(`  Lint: ${config.verifiers.lint}`);
  }
  if (config.verifiers.test) {
    console.log(`  Test: ${config.verifiers.test}`);
  }
  if (config.verifiers.security) {
    console.log(`  Security: ${config.verifiers.security}`);
  }
  if (!config.verifiers.typecheck && !config.verifiers.lint && !config.verifiers.test) {
    console.log('  (none detected - configure manually in .wink/config.json)');
  }

  console.log('\n✅ Setup complete!');
  console.log('\nNext steps:');
  console.log('  1. Run /verify to test your verifiers');
  console.log('  2. Run /wink to see session analysis');
  console.log('  3. Run /status to check current state');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Setup error:', err);
    process.exit(1);
  });
}
