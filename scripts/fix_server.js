import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

try {
  console.log('Restoring server.ts from Git...');
  // The command will be executed in the root of the workspace
  execSync('git checkout apps/api/src/server.ts', { stdio: 'inherit' });
  console.log('✅ Successfully restored apps/api/src/server.ts to its original pristine state!');
} catch (error) {
  console.error('Failed to restore file from Git:', error.message);
}
