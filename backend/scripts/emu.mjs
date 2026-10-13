// Runs the firebase CLI for EMULATOR commands only, with one Windows workaround.
//
//   node scripts/emu.mjs emulators:start
//   node scripts/emu.mjs emulators:exec --only auth,firestore "npm run seed"
//
// Why: on this machine the Firestore emulator (Java) dies at start with
// "Unable to establish loopback connection ... UnixDomainSockets.connect0", because Java
// cannot open its internal socket file in the user's %TEMP%. Pointing
// jdk.net.unixdomain.tmpdir at a folder inside backend/ fixes it (checked 2026-10-13,
// Temurin 25, firebase-tools 15.10.0). Harmless where the problem does not exist.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (!args[0] || !args[0].startsWith('emulators:')) {
    console.error('emu.mjs runs emulator commands only (emulators:start, emulators:exec). Nothing here deploys.');
    process.exit(1);
}

const backend = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
if (process.platform === 'win32') {
    const tmp = join(backend, '.emulator-tmp');
    mkdirSync(tmp, { recursive: true });
    env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ''} -Djdk.net.unixdomain.tmpdir=${tmp}`.trim();
}

const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const child = spawn(['firebase', ...args.map(quote)].join(' '), { cwd: backend, env, stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
