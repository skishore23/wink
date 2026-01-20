#!/usr/bin/env node

import { runVerification, formatVerifyResult } from '../core/verify';
import { detectVerifiers, getConfig, saveConfig } from '../core/config';

async function main() {
  try {
    console.log('🔍 Running verification...\n');
    
    // Get config and auto-detect verifiers if needed
    const config = await getConfig();
    
    if (Object.keys(config.verifiers).length === 0) {
      console.log('Auto-detecting verifiers for project...');
      const detected = detectVerifiers();

      if (Object.keys(detected).length > 0) {
        config.verifiers = { ...config.verifiers, ...detected };
        await saveConfig(config);
        console.log(`Found: ${Object.keys(detected).join(', ')}\n`);
      } else {
        console.log('No verifiers found. Configure them in .wink/config.json\n');
        console.log('Examples:\n');
        console.log('For Go:');
        console.log(JSON.stringify({
          verifiers: {
            typecheck: "go vet ./...",
            lint: "golangci-lint run",
            test: "go test ./...",
            build: "go build ./..."
          }
        }, null, 2));
        console.log('\nFor Node/TypeScript:');
        console.log(JSON.stringify({
          verifiers: {
            typecheck: "npm run typecheck",
            lint: "npm run lint",
            test: "npm test"
          }
        }, null, 2));
        process.exit(1);
      }
    }
    
    // Run full verification
    const result = await runVerification('full');
    
    // Display results
    console.log(formatVerifyResult(result));
    
    process.exit(result.allPassing ? 0 : 1);
    
  } catch (error) {
    console.error('Error running verification:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}