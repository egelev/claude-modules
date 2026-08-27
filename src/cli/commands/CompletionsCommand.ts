import { Command } from "./Command.js";

export class CompletionsCommand implements Command {
  constructor(private readonly script: string) {}

  async execute(): Promise<void> {
    process.stdout.write(this.script);
  }
}
