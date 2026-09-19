import { spawn } from 'node:child_process';
// Local Windows SDK initialization exceeded the CLI's 30-second worker deadline.
// This accommodates emulator startup only; it is not a production latency claim.
const child = spawn('firebase emulators:start --only hosting,functions,firestore --project demo-jumble', {
  shell: true, stdio: 'inherit',
  env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '300' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
