import 'server-only'

function fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
  return JSON.stringify({ level, ts: new Date().toISOString(), msg, ...meta })
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => process.stdout.write(fmt('info', msg, meta) + '\n'),
  warn: (msg: string, meta?: Record<string, unknown>) => process.stdout.write(fmt('warn', msg, meta) + '\n'),
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) =>
    process.stderr.write(
      fmt('error', msg, {
        ...meta,
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      }) + '\n'
    ),
}
