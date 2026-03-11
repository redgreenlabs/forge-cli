import pino from "pino";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

/** Logger configuration */
export interface LoggerOptions {
  level?: string;
  forgeDir?: string;
  pretty?: boolean;
}

/**
 * Create a structured logger for Forge.
 *
 * Logs to both stdout (pretty) and .forge/logs/forge.log (JSON).
 * Uses pino for structured JSON logging with timestamps.
 */
export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const level = options.level ?? "info";

  if (options.forgeDir) {
    const logsDir = join(options.forgeDir, "logs");
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    // File transport for structured logs
    const transport = pino.transport({
      targets: [
        {
          target: "pino/file",
          options: { destination: join(logsDir, "forge.log") },
          level,
        },
        ...(options.pretty
          ? [
              {
                target: "pino-pretty" as const,
                options: { colorize: true },
                level,
              },
            ]
          : []),
      ],
    });

    return pino({ level }, transport);
  }

  // Simple stdout logger
  return pino({ level });
}

/** Create a child logger for a specific module */
export function moduleLogger(
  parent: pino.Logger,
  moduleName: string
): pino.Logger {
  return parent.child({ module: moduleName });
}
