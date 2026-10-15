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
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (!args[0] || !args[0].startsWith('emulators:')) {
    console.error('emu.mjs runs emulator commands only (emulators:start, emulators:exec). Nothing here deploys.');
    process.exit(1);
}

const backend = join(dirname(fileURLToPath(import.meta.url)), '..');

// HKO (added 2026-10-15, see HKO.md): firebase.json lists two Firestore databases
// (lmsbox, hko). The Firestore emulator loads rules only when exactly ONE database is
// selected; with two it warns "does not support multiple databases yet" and allows
// every read and write. So, for the default config only, `firestore` in --only becomes
// `firestore:lmsbox`, and a missing --only gets the emulators firebase.json configures,
// with `firestore:lmsbox`. Result: lmsbox runs load exactly the rules they always did.
// Commands with --config (firebase.fn-test.json, firebase.hko-test.json) pass unchanged.
{
    const hasConfig = args.some((a) => a === '--config' || a === '-c' || a.startsWith('--config='));
    let cfg = null;
    try { cfg = JSON.parse(readFileSync(join(backend, 'firebase.json'), 'utf8')); } catch { /* firebase reports it */ }
    const dbs = Array.isArray(cfg?.firestore) ? cfg.firestore.map((f) => f.database) : [];
    if (!hasConfig && dbs.length > 1 && dbs.includes('lmsbox')) {
        const pin = (list) => list.split(',').map((t) => (t === 'firestore' ? 'firestore:lmsbox' : t)).join(',');
        const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
        if (i === -1) {
            const known = ['auth', 'functions', 'firestore', 'database', 'hosting', 'pubsub', 'storage', 'eventarc', 'dataconnect', 'tasks'];
            const present = known.filter((e) => cfg[e] !== undefined || cfg.emulators?.[e] !== undefined);
            args.splice(1, 0, '--only', pin(present.join(',')));
        } else if (args[i] === '--only') {
            if (args[i + 1]) args[i + 1] = pin(args[i + 1]);
        } else {
            args[i] = `--only=${pin(args[i].slice('--only='.length))}`;
        }
    }
}
const env = { ...process.env };
if (process.platform === 'win32') {
    const tmp = join(backend, '.emulator-tmp');
    mkdirSync(tmp, { recursive: true });
    env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ''} -Djdk.net.unixdomain.tmpdir=${tmp}`.trim();
}

const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const child = spawn(['firebase', ...args.map(quote)].join(' '), { cwd: backend, env, stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
