import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

async function createFixture(files: Record<string, string>): Promise<Record<string, string>> {
  const directory = await mkdtemp(join(tmpdir(), "jsonshape-cli-"));
  tempDirs.push(directory);
  const paths: Record<string, string> = {};
  for (const [name, contents] of Object.entries(files)) {
    const path = join(directory, name);
    await writeFile(path, contents, "utf8");
    paths[name] = path;
  }
  return paths;
}

function runCli(args: string[], stdin?: string) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/cli.ts", ...args],
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("jsonshape CLI", () => {
  test("declares a jsonshape bin and runs the entry point directly with Bun", async () => {
    const packageJson = JSON.parse(await Bun.file("package.json").text());
    expect(packageJson.bin.jsonshape).toBe("src/cli.ts");

    const result = Bun.spawnSync({
      cmd: [process.execPath, "src/cli.ts", "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      "Usage: jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--help] FILE...\n",
    );
    expect(result.stderr.toString()).toBe("");
  });

  test("accepts options before and after files, merges samples, and appends one newline", async () => {
    const files = await createFixture({
      "first.json": '{"id":1,"name":"Ann"}',
      "second.json": '{"id":2,"active":true}',
    });
    const result = runCli([
      "--name",
      "ApiResponse",
      files["first.json"],
      "--readonly",
      files["second.json"],
      "--type",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "export type ApiResponse = {",
        "  readonly id: number;",
        "  readonly name?: string;",
        "  readonly active?: boolean;",
        "};",
        "",
      ].join("\n"),
    );
  });

  test("reads stdin with '-' and ignores one leading UTF-8 BOM", () => {
    const result = runCli(["--name", "Payload", "-"], '\uFEFF{"value":"ok"}');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("export interface Payload {\n  value: string;\n}\n");
  });

  test("prints help and exits successfully without requiring input files", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Usage: jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--help] FILE...\n",
    );
    expect(result.stderr).toBe("");
  });

  test("reports no files and unknown options as usage errors", () => {
    const noFiles = runCli([]);
    const unknownOption = runCli(["--wat"]);

    expect(noFiles).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: no input files\n",
    });
    expect(unknownOption).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: unknown option: --wat\n",
    });
  });

  test("reports invalid and missing root names as usage errors", () => {
    const invalidName = runCli(["--name", "lower", "input.json"]);
    const missingName = runCli(["--name"]);

    expect(invalidName.exitCode).toBe(2);
    expect(invalidName.stdout).toBe("");
    expect(invalidName.stderr).toBe("jsonshape: invalid --name: lower\n");
    expect(missingName.exitCode).toBe(2);
    expect(missingName.stdout).toBe("");
    expect(missingName.stderr).toBe("jsonshape: --name needs a value\n");
  });

  test("reports unreadable files with exit 1 and no generated output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jsonshape-cli-"));
    tempDirs.push(directory);
    const missingPath = join(directory, "missing.json");
    const result = runCli([missingPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith(`jsonshape: cannot read ${missingPath}: `)).toBe(true);
    expect(result.stderr.endsWith("\n")).toBe(true);
  });

  test("reports invalid JSON with a stable prefix and does not emit earlier parsed documents", async () => {
    const files = await createFixture({
      "valid.json": '{"ok":true}',
      "invalid.json": "{",
    });
    const result = runCli([files["valid.json"], files["invalid.json"]]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith(`jsonshape: ${files["invalid.json"]}: invalid JSON: `)).toBe(
      true,
    );
    expect(result.stderr.endsWith("\n")).toBe(true);
  });

  test("reports the first failing file in argument order", async () => {
    const files = await createFixture({
      "invalid.json": "{",
    });
    const missingPath = join(tmpdir(), "jsonshape-does-not-exist.json");
    const result = runCli([files["invalid.json"], missingPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`jsonshape: ${files["invalid.json"]}: invalid JSON:`);
    expect(result.stderr).not.toContain("cannot read");
  });

  test("rejects mixed object and non-object roots with exit 1", async () => {
    const files = await createFixture({
      "object.json": '{"id":1}',
      "array.json": "[]",
    });
    const result = runCli([files["object.json"], files["array.json"]]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jsonshape: documents mix object and non-object roots\n");
  });
});
