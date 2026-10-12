#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { generateTypeScript } from "./jsonshape";

const usage = "Usage: jsonshape [--name ROOT] [--readonly] [--type] [--help] FILE...";

interface CliOptions {
  name: string;
  readonly: boolean;
  type: boolean;
  files: string[];
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    name: "Root",
    readonly: false,
    type: false,
    files: [],
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--readonly") options.readonly = true;
    else if (arg === "--type") options.type = true;
    else if (arg === "--name") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--name needs a value");
      index += 1;
      if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) throw new Error(`invalid --name: ${value}`);
      options.name = value;
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new Error(`unknown option: ${arg}`);
    } else options.files.push(arg);
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`jsonshape: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.files.length === 0) {
    console.error("jsonshape: no input files");
    process.exitCode = 2;
    return;
  }

  const documents: unknown[] = [];
  for (const file of options.files) {
    const displayPath = file === "-" ? "<stdin>" : file;
    let text: string;
    try {
      text = file === "-" ? await readStdin() : await readFile(file, "utf8");
    } catch (error) {
      console.error(
        `jsonshape: cannot read ${displayPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try {
      documents.push(JSON.parse(text));
    } catch (error) {
      console.error(
        `jsonshape: ${displayPath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return;
    }
  }

  try {
    console.log(generateTypeScript(documents, options));
  } catch (error) {
    console.error(`jsonshape: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
