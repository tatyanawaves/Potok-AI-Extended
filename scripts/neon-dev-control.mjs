import { spawn, execFile } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.join(ROOT_DIR, ".neon-runtime");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const PID_FILE = path.join(RUNTIME_DIR, "processes.json");

const DEFAULT_TIMEOUT_MS = 10000;

const SERVICES = {
  backend: {
    name: "backend",
    port: 8787,
    url: "http://127.0.0.1:8787/openaiProxy",
    command: process.execPath,
    args: [path.join(ROOT_DIR, "scripts", "codex-proxy.mjs")],
    logFile: path.join(LOG_DIR, "backend.log"),
  },
  frontend: {
    name: "frontend",
    port: 3001,
    url: "https://localhost:3001/threads",
    command: process.platform === "win32" ? "cmd.exe" : "npm",
    args: process.platform === "win32" ? ["/d", "/s", "/c", "npm run dev"] : ["run", "dev"],
    shell: false,
    logFile: path.join(LOG_DIR, "frontend.log"),
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureRuntimeDirs = () => {
  mkdirSync(LOG_DIR, { recursive: true });
};

const cleanEnv = () => {
  const env = {};
  let pathValue = "";

  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() === "path") {
      pathValue = value || pathValue;
      continue;
    }
    env[key] = value;
  }

  env.Path = pathValue;
  return env;
};

const readState = () => {
  if (!existsSync(PID_FILE)) return {};

  try {
    return JSON.parse(readFileSync(PID_FILE, "utf8"));
  } catch {
    return {};
  }
};

const writeState = (state) => {
  ensureRuntimeDirs();
  writeFileSync(PID_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const isProcessAlive = (pid) => {
  if (!pid || !Number.isInteger(Number(pid))) return false;

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const stopPid = async (pid, timeoutMs = 5000) => {
  if (!isProcessAlive(pid)) return { pid, stopped: false, reason: "not_running" };

  process.kill(Number(pid));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return { pid, stopped: true };
    await sleep(150);
  }

  return { pid, stopped: false, reason: "timeout" };
};

const isPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(600);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

const waitForPort = async (port, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await sleep(200);
  }

  return false;
};

const getWindowsPortPids = async (port) => {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
      windowsHide: true,
      timeout: 5000,
    });

    return [
      ...new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .filter((columns) => columns.length >= 5)
          .filter((columns) => columns[1]?.endsWith(`:${port}`) && columns[3] === "LISTENING")
          .map((columns) => Number(columns[4]))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
      ),
    ];
  } catch {
    return [];
  }
};

const getPortPids = async (port) => {
  if (process.platform === "win32") return getWindowsPortPids(port);
  return [];
};

const killPortPids = async (port) => {
  const pids = await getPortPids(port);
  const results = [];

  for (const pid of pids) {
    results.push(await stopPid(pid));
  }

  return results;
};

const selectedServices = (names) => {
  const requested = names?.length ? names : Object.keys(SERVICES);
  return requested.map((name) => {
    const service = SERVICES[name];
    if (!service) throw new Error(`Unknown NEON service: ${name}`);
    return service;
  });
};

export const neonDevStatus = async () => {
  const state = readState();
  const services = {};

  for (const [name, service] of Object.entries(SERVICES)) {
    const saved = state[name] || {};
    const alive = isProcessAlive(saved.pid);
    const portOpen = await isPortOpen(service.port);
    const portPids = await getPortPids(service.port);

    services[name] = {
      pid: saved.pid || null,
      pidAlive: alive,
      port: service.port,
      portOpen,
      portPids,
      url: service.url,
      logFile: path.relative(ROOT_DIR, service.logFile),
      startedAt: saved.startedAt || null,
    };
  }

  return {
    rootDir: ROOT_DIR,
    runtimeDir: path.relative(ROOT_DIR, RUNTIME_DIR),
    services,
  };
};

export const neonDevStart = async ({ services, forcePorts = false } = {}) => {
  ensureRuntimeDirs();
  const state = readState();
  const results = {};

  for (const service of selectedServices(services)) {
    const saved = state[service.name] || {};
    const savedAlive = isProcessAlive(saved.pid);
    const portOpen = await isPortOpen(service.port);

    if (savedAlive && portOpen) {
      results[service.name] = {
        status: "already_running",
        pid: saved.pid,
        port: service.port,
        url: service.url,
      };
      continue;
    }

    if (portOpen) {
      if (!forcePorts) {
        results[service.name] = {
          status: "port_busy",
          port: service.port,
          portPids: await getPortPids(service.port),
          hint: "Use forcePorts=true only when this dev port belongs to NEON.",
        };
        continue;
      }

      results[service.name] = {
        status: "port_stopped_before_start",
        port: service.port,
        stopped: await killPortPids(service.port),
      };
    }

    const logFd = openSync(service.logFile, "a");
    const child = spawn(service.command, service.args, {
      cwd: ROOT_DIR,
      detached: true,
      env: cleanEnv(),
      shell: service.shell || false,
      stdio: ["ignore", logFd, logFd],
      windowsHide: false,
    });

    child.unref();
    closeSync(logFd);

    const ready = await waitForPort(service.port);
    state[service.name] = {
      pid: child.pid,
      port: service.port,
      startedAt: new Date().toISOString(),
      command: service.command,
      args: service.args,
    };
    writeState(state);

    results[service.name] = {
      ...(results[service.name] || {}),
      status: ready ? "started" : "started_but_port_not_ready",
      pid: child.pid,
      port: service.port,
      url: service.url,
      logFile: path.relative(ROOT_DIR, service.logFile),
    };
  }

  return {
    ok: true,
    action: "start",
    results,
    status: await neonDevStatus(),
  };
};

export const neonDevStop = async ({ services, forcePorts = false } = {}) => {
  const state = readState();
  const results = {};

  for (const service of selectedServices(services)) {
    const saved = state[service.name] || {};
    const ownPidResult = saved.pid ? await stopPid(saved.pid) : { stopped: false, reason: "no_pid_file" };
    const forceResults = forcePorts ? await killPortPids(service.port) : [];

    delete state[service.name];
    results[service.name] = {
      pid: saved.pid || null,
      ownPidResult,
      forcePortResults: forceResults,
      port: service.port,
    };
  }

  writeState(state);

  return {
    ok: true,
    action: "stop",
    results,
    status: await neonDevStatus(),
  };
};

export const neonDevRestart = async ({ services, forcePorts = true } = {}) => {
  const stopped = await neonDevStop({ services, forcePorts });
  const started = await neonDevStart({ services, forcePorts });

  return {
    ok: true,
    action: "restart",
    stopped,
    started,
  };
};
