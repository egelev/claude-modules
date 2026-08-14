import pc from "picocolors";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private hasPrinted = false;
  private pendingSectionBreak = false;

  constructor(private level: LogLevel = LogLevel.INFO) {}

  debug(message: string): void {
    this.log(LogLevel.DEBUG, message);
  }

  info(message: string): void {
    this.log(LogLevel.INFO, message);
  }

  warn(message: string): void {
    this.log(LogLevel.WARN, message);
  }

  error(message: string): void {
    this.log(LogLevel.ERROR, message);
  }

  /**
   * Marks a break between logical sections of output. A blank line is inserted before the next
   * line actually printed — but only if something has printed already, so this is safe to call
   * unconditionally (e.g. before a block that might end up printing nothing, or as the first line
   * of a method that might itself be the first output of the whole run).
   */
  section(): void {
    if (this.hasPrinted) this.pendingSectionBreak = true;
  }

  private log(level: LogLevel, message: string): void {
    if (level < this.level) return;
    const stream = level >= LogLevel.WARN ? process.stderr : process.stdout;
    const line =
      level === LogLevel.ERROR
        ? pc.red(`${pc.bold("Error:")} ${message}`)
        : level === LogLevel.WARN
          ? pc.yellow(`${pc.bold("Warning:")} ${message}`)
          : level === LogLevel.DEBUG
            ? `debug: ${message}`
            : message;
    if (this.pendingSectionBreak) {
      stream.write("\n");
      this.pendingSectionBreak = false;
    }
    stream.write(`${line}\n`);
    this.hasPrinted = true;
  }
}
