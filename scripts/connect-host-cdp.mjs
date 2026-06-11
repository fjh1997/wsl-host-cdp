#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_LOCAL_PORT = 59222;
const DEFAULT_LOG = '/tmp/wsl-host-cdp-forward.log';

const BROWSERS = {
  edge: {
    label: 'Microsoft Edge',
    winDevToolsSuffix: ['Microsoft', 'Edge', 'User Data', 'DevToolsActivePort'],
    wslDevToolsPath: path.join(os.homedir(), '.config', 'microsoft-edge', 'DevToolsActivePort'),
  },
  chrome: {
    label: 'Google Chrome',
    winDevToolsSuffix: ['Google', 'Chrome', 'User Data', 'DevToolsActivePort'],
    wslDevToolsPath: path.join(os.homedir(), '.config', 'google-chrome', 'DevToolsActivePort'),
  },
};

function parseArgs(argv) {
  const opts = {
    browser: 'edge',
    localPort: DEFAULT_LOCAL_PORT,
    hostPort: null,
    wsPath: null,
    ncat: null,
    serve: false,
    testOnly: false,
    logFile: DEFAULT_LOG,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };

    if (arg === '--browser') opts.browser = next();
    else if (arg.startsWith('--browser=')) opts.browser = arg.slice('--browser='.length);
    else if (arg === '--local-port') opts.localPort = Number(next());
    else if (arg.startsWith('--local-port=')) opts.localPort = Number(arg.slice('--local-port='.length));
    else if (arg === '--host-port') opts.hostPort = Number(next());
    else if (arg.startsWith('--host-port=')) opts.hostPort = Number(arg.slice('--host-port='.length));
    else if (arg === '--ws-path') opts.wsPath = next();
    else if (arg.startsWith('--ws-path=')) opts.wsPath = arg.slice('--ws-path='.length);
    else if (arg === '--ncat') opts.ncat = next();
    else if (arg.startsWith('--ncat=')) opts.ncat = arg.slice('--ncat='.length);
    else if (arg === '--serve') opts.serve = true;
    else if (arg === '--test-only' || arg === '--status') opts.testOnly = true;
    else if (arg === '--log-file') opts.logFile = next();
    else if (arg.startsWith('--log-file=')) opts.logFile = arg.slice('--log-file='.length);
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!BROWSERS[opts.browser]) throw new Error(`Unsupported browser: ${opts.browser}. Use edge or chrome.`);
  if (!Number.isInteger(opts.localPort) || opts.localPort <= 0 || opts.localPort > 65535) {
    throw new Error(`Invalid --local-port: ${opts.localPort}`);
  }
  if (opts.hostPort !== null && (!Number.isInteger(opts.hostPort) || opts.hostPort <= 0 || opts.hostPort > 65535)) {
    throw new Error(`Invalid --host-port: ${opts.hostPort}`);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  node scripts/connect-host-cdp.mjs --browser edge
  node scripts/connect-host-cdp.mjs --browser chrome

Options:
  --browser edge|chrome     Host browser to bridge. Default: edge
  --local-port PORT         WSL loopback port. Default: ${DEFAULT_LOCAL_PORT}
  --host-port PORT          Windows host DevTools port. Default: read DevToolsActivePort
  --ws-path PATH            Browser WebSocket path. Default: read DevToolsActivePort
  --ncat PATH               Windows ncat.exe path. Default: auto-detect
  --test-only, --status     Only validate the current WSL bridge; do not start or rewrite it
  --log-file PATH           Forwarder log file. Default: ${DEFAULT_LOG}

Stop:
  pkill -f wsl-host-cdp-forward`);
}

function normalizeOutput(text) {
  return String(text || '').replace(/\r/g, '').trim();
}

function run(command, args, options = {}) {
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  return {
    status: res.status,
    stdout: normalizeOutput(res.stdout),
    stderr: normalizeOutput(res.stderr),
    error: res.error,
  };
}

function powershell(command) {
  return run('powershell.exe', ['-NoProfile', '-Command', command]);
}

function winPathToWsl(input) {
  const value = normalizeOutput(input).replace(/^"|"$/g, '');
  if (!value) return '';
  if (value.startsWith('/')) return value;
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return value.replace(/\\/g, '/');
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

function existingFile(...candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function getWindowsLocalAppData() {
  const result = powershell('[Environment]::GetFolderPath("LocalApplicationData")');
  if (result.status === 0 && result.stdout) return winPathToWsl(result.stdout);
  const envResult = powershell('$env:LOCALAPPDATA');
  if (envResult.status === 0 && envResult.stdout) return winPathToWsl(envResult.stdout);
  return null;
}

function readDevToolsFile(browserId, opts) {
  if (opts.hostPort && opts.wsPath) {
    return { hostPort: opts.hostPort, wsPath: opts.wsPath, source: 'cli' };
  }
  if (opts.hostPort && !opts.wsPath) {
    throw new Error('--host-port requires --ws-path because browser WebSocket paths include a UUID.');
  }

  const browser = BROWSERS[browserId];
  const localAppData = getWindowsLocalAppData();
  const suffix = path.join(...browser.winDevToolsSuffix);
  const candidates = [];
  if (localAppData) candidates.push(path.join(localAppData, suffix));
  candidates.push(path.join('/mnt/c/Users', process.env.USER || '', 'AppData', 'Local', suffix));

  const file = existingFile(...candidates);
  if (!file) {
    throw new Error(
      `Cannot find Windows ${browser.label} DevToolsActivePort.\n` +
      `Open ${browserId === 'edge' ? 'edge' : 'chrome'}://inspect/#remote-debugging on the Windows host and enable ` +
      `"Allow remote debugging for this browser instance", then rerun this script.`
    );
  }

  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const hostPort = Number(lines[0]);
  const wsPath = lines[1];
  if (!Number.isInteger(hostPort) || hostPort <= 0 || hostPort > 65535 || !wsPath) {
    throw new Error(`Invalid DevToolsActivePort content at ${file}`);
  }
  return { hostPort, wsPath, source: file };
}

function findNcat(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);

  const which = run('bash', ['-lc', 'command -v ncat.exe || true']);
  if (which.stdout) candidates.push(which.stdout);

  const ps = powershell('(Get-Command ncat.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)');
  if (ps.status === 0 && ps.stdout) candidates.push(winPathToWsl(ps.stdout));

  candidates.push(
    '/mnt/c/Program Files (x86)/Nmap/ncat.exe',
    '/mnt/c/Program Files/Nmap/ncat.exe'
  );

  const found = existingFile(...candidates);
  if (!found) {
    throw new Error(
      'Cannot find Windows ncat.exe. Install Nmap for Windows or pass --ncat /mnt/c/path/to/ncat.exe.'
    );
  }
  return found;
}

function checkTcp(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function writeWslDevToolsFile(browserId, localPort, wsPath) {
  const file = BROWSERS[browserId].wslDevToolsPath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${localPort}\n${wsPath}\n`);
  return file;
}

function readWslDevToolsFile(browserId, opts) {
  if (opts.wsPath) {
    return { localPort: opts.localPort, wsPath: opts.wsPath, source: 'cli' };
  }

  const file = BROWSERS[browserId].wslDevToolsPath;
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `Cannot find WSL DevToolsActivePort at ${file}.\n` +
      'Run without --test-only once to create the bridge, or pass --ws-path explicitly.'
    );
  }

  const lines = content.trim().split(/\r?\n/).filter(Boolean);
  const localPort = Number(lines[0]);
  const wsPath = lines[1];
  if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535 || !wsPath) {
    throw new Error(`Invalid WSL DevToolsActivePort content at ${file}`);
  }
  return { localPort, wsPath, source: file };
}

async function validateWebSocket(localPort, wsPath) {
  if (typeof globalThis.WebSocket === 'undefined') {
    throw new Error('Node.js 22+ is required for native WebSocket validation.');
  }

  const wsUrl = `ws://127.0.0.1:${localPort}${wsPath}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error(`Timed out validating ${wsUrl}`));
    }, 6000);
    if (typeof timer.unref === 'function') timer.unref();

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      callback(value);
    };

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
    });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === 1 && msg.result && Array.isArray(msg.result.targetInfos)) {
          finish(resolve, msg.result.targetInfos.length);
        }
      } catch (error) {
        finish(reject, error);
      }
    });
    ws.addEventListener('error', () => {
      finish(reject, new Error(`Failed to open ${wsUrl}`));
    });
  });
}

function startForwarder(opts, hostPort, ncat) {
  const logFd = fs.openSync(opts.logFile, 'a');
  const child = spawn(process.execPath, [
    SELF,
    '--serve',
    '--local-port', String(opts.localPort),
    '--host-port', String(hostPort),
    '--ncat', ncat,
    '--log-file', opts.logFile,
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  return child.pid;
}

async function serve(opts) {
  process.title = 'wsl-host-cdp-forward';
  const ncat = opts.ncat || findNcat(null);
  if (!opts.hostPort) throw new Error('--serve requires --host-port');

  const server = net.createServer((socket) => {
    const proc = spawn(ncat, ['127.0.0.1', String(opts.hostPort)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    socket.pipe(proc.stdin);
    proc.stdout.pipe(socket);
    proc.stderr.on('data', (data) => process.stderr.write(data));

    const cleanup = () => {
      socket.destroy();
      if (!proc.killed) proc.kill();
    };
    socket.on('error', cleanup);
    socket.on('close', cleanup);
    proc.on('error', cleanup);
    proc.on('exit', () => socket.destroy());
    proc.stdin.on('error', () => {});
  });

  server.on('error', (error) => {
    console.error(`[wsl-host-cdp-forward] ${error.message}`);
    process.exit(1);
  });

  server.listen(opts.localPort, '127.0.0.1', () => {
    console.log(
      `[wsl-host-cdp-forward] listening 127.0.0.1:${opts.localPort} -> Windows 127.0.0.1:${opts.hostPort}`
    );
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.serve) {
    await serve(opts);
    return;
  }

  const browser = BROWSERS[opts.browser];
  if (opts.testOnly) {
    const { localPort, wsPath, source } = readWslDevToolsFile(opts.browser, opts);
    const count = await validateWebSocket(localPort, wsPath);
    console.log(`OK: existing bridge works (${count} targets).`);
    console.log(`browser: ${browser.label}`);
    console.log(`WSL local: 127.0.0.1:${localPort}`);
    console.log(`WebSocket path: ${wsPath}`);
    console.log(`source: ${source}`);
    return;
  }

  const { hostPort, wsPath, source } = readDevToolsFile(opts.browser, opts);
  const ncat = findNcat(opts.ncat);
  const wslFile = writeWslDevToolsFile(opts.browser, opts.localPort, wsPath);

  let startedPid = null;
  if (await checkTcp(opts.localPort)) {
    try {
      const count = await validateWebSocket(opts.localPort, wsPath);
      console.log(`OK: existing bridge works (${count} targets).`);
    } catch (error) {
      throw new Error(
        `Local port ${opts.localPort} is already in use but validation failed: ${error.message}\n` +
        'Stop stale bridges with: pkill -f wsl-host-cdp-forward'
      );
    }
  } else {
    startedPid = startForwarder(opts, hostPort, ncat);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const count = await validateWebSocket(opts.localPort, wsPath);
    console.log(`OK: bridge started (${count} targets).`);
  }

  console.log(`browser: ${browser.label}`);
  console.log(`host DevTools: 127.0.0.1:${hostPort}`);
  console.log(`source: ${source}`);
  console.log(`WSL local: 127.0.0.1:${opts.localPort}`);
  console.log(`WebSocket path: ${wsPath}`);
  console.log(`WSL DevToolsActivePort: ${wslFile}`);
  console.log(`ncat: ${ncat}`);
  if (startedPid) console.log(`forwarder pid: ${startedPid}`);
  console.log(`log: ${opts.logFile}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}).then(() => {
  if (!process.argv.includes('--serve')) process.exit(0);
});
