#!/usr/bin/env node
/**
 * sano.music — universal entry point.
 *
 * Hosting panels (OptikLink, Katabump, Railway, Glacier, Pterodactyl, etc.)
 * usually run `node index.js` or `node src/Bot.ts` automatically. The latter
 * crashes on modern Node because TypeScript is not executed natively.
 *
 * This file:
 *   1. Boots the compiled bundle from `dist/Bot.js` if it exists.
 *   2. Otherwise builds it on the fly with `tsup`, then boots.
 *   3. Falls back to `tsx` when neither is possible.
 *
 * Net effect: the bot starts no matter how the panel invokes it, with no
 * extra configuration required from the user.
 */

const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DIST_ENTRY = path.join(ROOT, 'dist', 'Bot.js');

function log(msg) {
  console.log(`[sano] ${msg}`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts });
}

function ensureDependencies() {
  const nodeModules = path.join(ROOT, 'node_modules');
  if (fs.existsSync(nodeModules)) return;
  log('node_modules missing — running `npm install` (one-time)');
  const result = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
  ]);
  if (result.status !== 0) {
    log('npm install failed — aborting');
    process.exit(result.status || 1);
  }
}

function buildIfNeeded() {
  if (fs.existsSync(DIST_ENTRY)) return true;

  log('dist/Bot.js not found — building with tsup');
  const tsup = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsup.cmd' : 'tsup');
  if (!fs.existsSync(tsup)) {
    log('tsup not installed (devDependency); installing build deps');
    const install = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund']);
    if (install.status !== 0) return false;
  }
  const result = run(tsup, ['./src/Bot.ts', '--minify']);
  return result.status === 0 && fs.existsSync(DIST_ENTRY);
}

function startCompiled() {
  log('starting from dist/Bot.js');
  const child = spawn(process.execPath, [DIST_ENTRY], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => process.exit(code ?? 0));
  forwardSignals(child);
}

function startWithTsx() {
  log('starting via tsx (development mode)');
  const tsx = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (!fs.existsSync(tsx)) {
    log('tsx not available — please run `npm install` and `npm run build` first.');
    process.exit(1);
  }
  const child = spawn(tsx, ['./src/Bot.ts'], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => process.exit(code ?? 0));
  forwardSignals(child);
}

function forwardSignals(child) {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try {
        child.kill(sig);
      } catch (_) {
        /* noop */
      }
    });
  }
}

(function main() {
  ensureDependencies();
  if (buildIfNeeded()) {
    startCompiled();
  } else {
    startWithTsx();
  }
})();
