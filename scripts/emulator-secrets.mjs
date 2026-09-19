import { writeFile } from 'node:fs/promises';
// Explicit fake values, consumed only by local Firebase emulators. Never production credentials.
await writeFile('.secret.local','JUMBLE_COOKIE_SECRET=local-emulator-only-cookie-secret\nSTRIPE_SECRET_KEY=sk_test_local_emulator_not_a_credential\nSTRIPE_WEBHOOK_SECRET=whsec_local_emulator_not_a_credential\n',{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
