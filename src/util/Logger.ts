export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  constructor(private level: LogLevel = LogLevel.INFO) {}

  debug(message: string): void {
    this.log(LogLevel.DEBUG, "debug", message);
  }

  info(message: string): void {
    this.log(LogLevel.INFO, "info", message);
  }

  warn(message: string): void {
    this.log(LogLevel.WARN, "warn", message);
  }

  error(message: string): void {
    this.log(LogLevel.ERROR, "error", message);
  }

  private log(level: LogLevel, label: string, message: string): void {
    if (level < this.level) return;
    const stream = level >= LogLevel.WARN ? process.stderr : process.stdout;
    stream.write(`[claude-profiles] ${label}: ${message}\n`);
  }
}
