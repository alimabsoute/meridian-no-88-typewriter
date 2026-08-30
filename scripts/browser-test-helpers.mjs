import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BRAND } from '../src/brand.js';

export const DEFAULT_PREVIEW_URL = 'http://127.0.0.1:4177/';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_PORT = 4177;
const START_TIMEOUT_MS = 30_000;
const PRODUCT_MARKER = BRAND.displayName;

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function pathCandidates(names, environment = process.env) {
  const pathEntries = String(environment.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  return pathEntries.flatMap((entry) => names.map((name) => path.join(entry, name)));
}

export function browserExecutableCandidates({ platform = process.platform, environment = process.env } = {}) {
  if (platform === 'win32') {
    const programFiles = environment.ProgramFiles;
    const programFilesX86 = environment['ProgramFiles(x86)'];
    const localAppData = environment.LOCALAPPDATA;
    return unique([
      programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      localAppData && path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ...pathCandidates(['chrome.exe', 'msedge.exe', 'chromium.exe'], environment),
    ]);
  }

  if (platform === 'darwin') {
    return unique([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(environment.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ...pathCandidates(['google-chrome', 'chromium', 'microsoft-edge'], environment),
    ]);
  }

  return unique([
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/snap/bin/chromium',
    ...pathCandidates([
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'microsoft-edge-stable',
    ], environment),
  ]);
}

async function isAccessible(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBrowserExecutable(environment = process.env) {
  const override = environment.CHROME_PATH?.trim();
  if (override) {
    const resolved = path.resolve(override);
    if (await isAccessible(resolved)) return resolved;
    throw new Error(`CHROME_PATH does not point to an accessible browser executable: ${resolved}`);
  }

  const candidates = browserExecutableCandidates({ environment });
  for (const candidate of candidates) {
    if (await isAccessible(candidate)) return candidate;
  }

  throw new Error([
    'No supported Chrome, Chromium, or Edge executable was found.',
    'Install one of those browsers or set CHROME_PATH to its executable.',
    `Checked: ${candidates.join(' | ')}`,
  ].join(' '));
}

export async function launchBrowser({
  allowFileAccess = false,
  disableWebgl = false,
  headless = true,
  extraArgs = [],
} = {}) {
  const executablePath = await resolveBrowserExecutable();
  const args = [
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];

  if (disableWebgl) {
    args.push('--disable-webgl', '--disable-software-rasterizer');
  } else {
    args.push('--enable-webgl');
    if (process.platform === 'win32') args.push('--use-angle=d3d11');
    if (process.platform === 'linux') {
      args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage');
    }
  }
  if (allowFileAccess) args.push('--allow-file-access-from-files');
  args.push(...extraArgs);

  return chromium.launch({ executablePath, headless, args });
}

export function withQuality(targetUrl, quality) {
  const url = new URL(targetUrl);
  if (!quality || quality === 'default') url.searchParams.delete('quality');
  else url.searchParams.set('quality', quality);
  return url.href;
}

function isManagedLocalPreview(url) {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    && port === PREVIEW_PORT;
}

async function probeHtml(targetUrl, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      cache: 'no-store',
      headers: { accept: 'text/html' },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      reachable: response.ok,
      isExpectedProduct: response.ok && body.includes(PRODUCT_MARKER),
      status: response.status,
    };
  } catch {
    return { reachable: false, isExpectedProduct: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

export async function ensurePreviewServer({ targetUrl = DEFAULT_PREVIEW_URL } = {}) {
  const normalizedTarget = new URL(targetUrl).href;
  const url = new URL(normalizedTarget);
  const initialProbe = await probeHtml(normalizedTarget);

  if (initialProbe.reachable) {
    if (!initialProbe.isExpectedProduct && isManagedLocalPreview(url)) {
      throw new Error(`Port ${PREVIEW_PORT} is already serving a different application; it was left untouched.`);
    }
    return {
      targetUrl: normalizedTarget,
      started: false,
      close: async () => {},
    };
  }

  if (!isManagedLocalPreview(url)) {
    throw new Error(`TARGET_URL is not reachable and is not the managed local preview: ${normalizedTarget}`);
  }

  const viteEntry = path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  await access(viteEntry);
  const output = [];
  const child = spawn(process.execPath, [
    viteEntry,
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(PREVIEW_PORT),
    '--strictPort',
  ], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const rememberOutput = (chunk) => {
    output.push(String(chunk));
    if (output.join('').length > 8_000) output.shift();
  };
  child.stdout.on('data', rememberOutput);
  child.stderr.on('data', rememberOutput);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = await probeHtml(normalizedTarget);
    if (probe.reachable && probe.isExpectedProduct) {
      let closed = false;
      return {
        targetUrl: normalizedTarget,
        started: true,
        async close() {
          if (closed) return;
          closed = true;
          await stopChild(child);
        },
      };
    }
    if (child.exitCode !== null) {
      const raceProbe = await probeHtml(normalizedTarget);
      if (raceProbe.reachable && raceProbe.isExpectedProduct) {
        return { targetUrl: normalizedTarget, started: false, close: async () => {} };
      }
      throw new Error(`Local preview exited before it was ready (code ${child.exitCode}). ${output.join('').trim()}`);
    }
    await delay(125);
  }

  await stopChild(child);
  throw new Error(`Local preview did not become ready within ${START_TIMEOUT_MS / 1_000} seconds. ${output.join('').trim()}`);
}
