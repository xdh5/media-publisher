import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CliResult {
  exitCode: number;
  jsonLines: unknown[];
  stderr: string;
  lastJson: unknown | null;
}

const VERSION_NOISE = /^\d+\.\d+\.\d+/;
const DEVTOOLS_NOISE = /^DevTools listening/;
const LOG_PREFIX = /^\[[^\]]+\] \[(?:LOG|INFO|WARN|ERROR|DEBUG)\] /;
const TIMEOUT_MS = Number(process.env.MEDIA_PUBLISHER_TIMEOUT_SECONDS || "14520") * 1000;
let publicationQueue: Promise<unknown> = Promise.resolve();

/** 仅清理本次创建的进程树。 */
export function stopCliProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    child.kill("SIGTERM");
  }
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  return VERSION_NOISE.test(trimmed) || DEVTOOLS_NOISE.test(trimmed);
}

function stripLogPrefix(line: string): string {
  return line.replace(LOG_PREFIX, '');
}

function stripNoiseLines(raw: string): string {
  return raw
    .split('\n')
    .map((line) => stripLogPrefix(line))
    .filter((line) => !isNoiseLine(line.trim()))
    .join('\n')
    .trim();
}

function tryParseJson(raw: string): unknown | null {
  const cleaned = stripNoiseLines(raw);
  if (cleaned.length === 0) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }
  const starts = [cleaned.indexOf('['), cleaned.indexOf('{')].filter((index) => index >= 0);
  if (starts.length === 0) return null;
  const slice = cleaned.slice(Math.min(...starts));
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/** media-publisher 仓库根目录。编译后位于 mcp/dist，向上三级即仓库根。 */
export function matrixDir(): string {
  const defaultDir = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  return process.env.MEDIA_PUBLISHER_DIR ?? defaultDir;
}

export function resolveCliSpawn(args: string[]): {
  command: string;
  spawnArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const dir = matrixDir();
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.MEDIA_PUBLISHER_PARENT_PID = String(process.pid);

  const executable = process.env.MEDIA_PUBLISHER_EXECUTABLE;
  if (executable) {
    if (!fs.existsSync(executable)) throw new Error("配置的 Publisher 可执行文件不存在");
    delete env.ELECTRON_RUN_AS_NODE;
    return { command: executable, spawnArgs: ["cli", ...args], cwd: dir, env };
  }

  const localElectronBin = process.platform === 'win32'
    ? path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(dir, 'node_modules', '.bin', 'electron');
  const localRuntimeAvailable = fs.existsSync(localElectronBin);
  let installed = false;
  if (!localRuntimeAvailable) {
    try {
      execSync(process.platform === 'win32' ? 'where.exe media-publisher' : 'which media-publisher', { stdio: 'pipe' });
      installed = true;
    } catch {
      installed = false;
    }
  }

  if (installed) {
    return { command: 'media-publisher', spawnArgs: ['cli', ...args], cwd: dir, env };
  }
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') {
      delete env[key];
    }
  }
  return {
    command: localElectronBin,
    // `--` 防止 Chromium 把 --partition / --tags 等 CLI 参数当成浏览器开关并直接崩溃
    spawnArgs: ['.', '--', 'cli', ...args],
    cwd: dir,
    env,
  };
}

export function spawnCli(args: string[]): ChildProcess {
  const { command, spawnArgs, cwd, env } = resolveCliSpawn(args);
  return spawn(command, spawnArgs, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** 调用矩媒 publishing。发布、账号和平台定义都在 python/publishing。 */
export function runMatrixPublish(
  args: string[],
  options?: { stdin?: string; timeoutMs?: number; onProgress?: (text: string) => void },
): Promise<CliResult> {
  if (args[0] !== "publish") return executeMatrixPublish(args, options);
  options?.onProgress?.("等待发布队列");
  const pending = publicationQueue.then(() => executeMatrixPublish(args, options));
  publicationQueue = pending.catch(() => {});
  return pending;
}

function executeMatrixPublish(
  args: string[],
  options?: { stdin?: string; timeoutMs?: number; onProgress?: (text: string) => void },
): Promise<CliResult> {
  const command = process.env.MEDIA_PUBLISHER_PYTHON || "python";
  const spawnArgs = command === "py"
    ? ["-3", "-m", "publishing", ...args]
    : ["-m", "publishing", ...args];
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const dir = matrixDir();
  const pythonDir = path.join(dir, "python");
  const currentPath = process.env.PYTHONPATH;
  return new Promise((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd: dir,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        MEDIA_PUBLISHER_OWNER_PID: String(process.pid),
        PYTHONPATH: currentPath ? `${pythonDir}${path.delimiter}${currentPath}` : pythonDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastJson = tryParseJson(stdout) ?? tryParseJson(stderr);
      resolve({
        exitCode: code,
        jsonLines: lastJson == null ? [] : [lastJson],
        stderr: stripNoiseLines(stderr),
        lastJson,
      });
    };
    const timer = args[0] === "publish" ? undefined : setTimeout(() => {
      try {
        stopCliProcess(child);
      } catch {
        /* ignore */
      }
      stderr += "\npublishing 超时";
      finish(1);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (!options?.onProgress) return;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("MM_PROGRESS\t")) {
          options.onProgress(line.slice("MM_PROGRESS\t".length).trim());
        }
      }
    });
    child.on("error", (err: Error) => {
      stderr += String(err.message);
      finish(1);
    });
    child.on("close", (code: number | null) => {
      finish(typeof code === "number" ? code : 1);
    });
    child.stdin?.on("error", (error: Error) => {
      stderr += `\n发布请求写入失败：${error.message}`;
      stopCliProcess(child);
      finish(1);
    });
    child.stdin?.end(options?.stdin);
  });
}
