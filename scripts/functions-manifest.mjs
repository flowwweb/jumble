import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// Firebase SDK's supported file-output route avoids Windows loopback discovery timeouts.
const result=spawnSync(process.execPath,['node_modules/firebase-functions/lib/bin/firebase-functions.js'],{stdio:'inherit',env:{...process.env,FUNCTIONS_MANIFEST_OUTPUT_PATH:resolve('functions.yaml')}});
process.exit(result.status??1);
