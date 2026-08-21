import { Command } from "./Command.js";

export class HelpCommand implements Command {
  constructor(private readonly text: string) {}

  async execute(): Promise<void> {
    process.stdout.write(this.text);
  }
}
