import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

const MAX_RECENT_ERRORS = 100;

type LogLevel = "warn" | "error";

export type BackendErrorEvent = {
  id: string;
  level: LogLevel;
  message: string;
  code?: string;
  statusCode?: number;
  method?: string;
  url?: string;
  ip?: string;
  requestId?: string;
  stack?: string;
  createdAt: string;
};

const recentErrors: BackendErrorEvent[] = [];

function errorLogPath() {
  return resolve(process.env.ERROR_LOG_PATH?.trim() || "../../.data/api-errors.log");
}

function serializeErrorEvent(event: BackendErrorEvent) {
  return `${JSON.stringify(event)}\n`;
}

export function recentBackendErrors(limit = 50): BackendErrorEvent[] {
  return recentErrors.slice(0, Math.max(1, Math.min(MAX_RECENT_ERRORS, limit)));
}

export async function readBackendErrorLogTail(limit = 50): Promise<BackendErrorEvent[]> {
  try {
    const raw = await readFile(errorLogPath(), "utf8");
    return raw
      .trim()
      .split("\n")
      .slice(-Math.max(1, Math.min(500, limit)))
      .map((line) => JSON.parse(line) as BackendErrorEvent)
      .reverse();
  } catch {
    return [];
  }
}

export function recordBackendError(event: Omit<BackendErrorEvent, "id" | "createdAt">): BackendErrorEvent {
  const fullEvent: BackendErrorEvent = {
    ...event,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  recentErrors.unshift(fullEvent);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.length = MAX_RECENT_ERRORS;

  void (async () => {
    try {
      const filePath = errorLogPath();
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, serializeErrorEvent(fullEvent), "utf8");
    } catch {
      // The in-memory ring still keeps the latest errors if disk logging fails.
    }
  })();

  return fullEvent;
}
