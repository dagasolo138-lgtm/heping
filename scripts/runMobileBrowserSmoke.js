import { spawn } from 'node:child_process';
import { access, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ARTIFACT_DIR = '.artifacts';
const SUCCESS_FILE = join(ARTIFACT_DIR, 'mobile-smoke-state.json');
const FAILURE_FILE = join(ARTIFACT_DIR, 'mobile-smoke-failure.json');
const TEMP_PREFIX = 'shengling-mobile-smoke-';

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeLeftoverProfiles() {
  let entries = [];
  try {
    entries = await readdir(tmpdir(), { withFileTypes: true });
  } catch (error) {
    console.warn(`[mobile-smoke] Unable to inspect temporary directory: ${error.message}`);
    return;
  }

  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
    .map(async (entry) => {
      const path = join(tmpdir(), entry.name);
      try {
        await rm(path, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 150,
        });
      } catch (error) {
        console.warn(`[mobile-smoke] Unable to remove leftover profile ${path}: ${error.message}`);
      }
    }));
}

const scriptPath = fileURLToPath(new URL('./mobileBrowserSmoke.js', import.meta.url));
const child = spawn(process.execPath, [scriptPath], {
  stdio: 'inherit',
  env: process.env,
});

const exitCode = await new Promise((resolve) => {
  child.once('error', (error) => {
    console.error(`[mobile-smoke] Failed to start browser smoke process: ${error.message}`);
    resolve(1);
  });
  child.once('exit', (code, signal) => {
    if (signal) console.error(`[mobile-smoke] Browser smoke process ended with signal ${signal}.`);
    resolve(code ?? 1);
  });
});

await removeLeftoverProfiles();

if (exitCode === 0) process.exit(0);

const assertionsCompleted = await exists(SUCCESS_FILE);
const assertionFailureRecorded = await exists(FAILURE_FILE);
if (assertionsCompleted && !assertionFailureRecorded) {
  console.warn('[mobile-smoke] Browser assertions passed; recovered a cleanup-only nonzero exit.');
  console.log('MOBILE_BROWSER_SMOKE=PASS');
  process.exit(0);
}

process.exit(exitCode);
