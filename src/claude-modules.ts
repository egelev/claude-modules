#!/usr/bin/env node
import { Cli } from "./cli/Cli.js";

const cli = new Cli();
const exitCode = await cli.run(process.argv.slice(2));
process.exit(exitCode);
