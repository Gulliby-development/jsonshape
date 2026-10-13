import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

async function createFixture(files: Record<string, string>): Promise<Record<string, string>> {
  const directory = await mkdtemp(join(tmpdir(), "jsonshape-ndjson-"));
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
    timeout: 30_000,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().replace(/\r\n/g, "\n"),
    stderr: result.stderr.toString().replace(/\r\n/g, "\n"),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("jsonshape NDJSON input", () => {
  test("prints the documented file example exactly", async () => {
    const files = await createFixture({
      "events.ndjson": '{"id":1,"tags":["a"]}\n\n{"id":2,"name":"x"}\n',
    });
    const result = runCli(["--ndjson", files["events.ndjson"]]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "export interface Root {",
        "  id: number;",
        "  tags?: string[];",
        "  name?: string;",
        "}",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("prints the documented stdin example with name and type options exactly", () => {
    const result = runCli(
      ["--name", "Event", "--type", "--ndjson", "-"],
      '{"id":1,"tags":["a"]}\n\n{"id":2,"name":"x"}\n',
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "export type Event = {",
        "  id: number;",
        "  tags?: string[];",
        "  name?: string;",
        "};",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("handles CRLF files and skips spaces-only, tab-only, and CR-only lines", async () => {
    const files = await createFixture({
      "whitespace.ndjson": '  \r\n\t\r\n\r\n{"value":1}\r\n',
    });
    const result = runCli(["--ndjson", files["whitespace.ndjson"]]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n  value: number;\n}\n",
      stderr: "",
    });
  });

  test("skips one leading BOM in an NDJSON source", async () => {
    const files = await createFixture({
      "bom.ndjson": '\uFEFF{"value":"ok"}\n',
    });
    const result = runCli(["--ndjson", files["bom.ndjson"]]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n  value: string;\n}\n",
      stderr: "",
    });
  });

  test("accepts --ndjson before and after input paths", async () => {
    const files = await createFixture({ "samples.ndjson": '{"id":1}\n{"id":2}\n' });
    const before = runCli(["--ndjson", files["samples.ndjson"]]);
    const after = runCli([files["samples.ndjson"], "--ndjson"]);
    const expected = "export interface Root {\n  id: number;\n}\n";

    expect(before.exitCode).toBe(0);
    expect(before.stdout).toBe(expected);
    expect(before.stderr).toBe("");
    expect(after).toEqual(before);
  });

  test("allows an empty source when another source contains samples", async () => {
    const files = await createFixture({
      "empty.ndjson": " \n\t\n",
      "samples.ndjson": '{"id":1}\n{"name":"x"}\n',
    });
    const result = runCli([
      "--ndjson",
      files["empty.ndjson"],
      files["samples.ndjson"],
      "--name",
      "Entry",
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "export interface Entry {\n  id?: number;\n  name?: string;\n}\n",
      stderr: "",
    });
  });

  test("merges samples from two populated files around an empty source in argument order", async () => {
    const files = await createFixture({
      "first.ndjson": '{"first":1}\n',
      "empty.ndjson": "",
      "second.ndjson": '{"second":true,"first":2}\n',
    });
    const result = runCli([
      "--ndjson",
      files["first.ndjson"],
      files["empty.ndjson"],
      files["second.ndjson"],
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n  first: number;\n  second?: boolean;\n}\n",
      stderr: "",
    });
  });

  test("applies --name, --readonly, and --type to merged NDJSON samples", async () => {
    const files = await createFixture({
      "records.ndjson": '{"id":1,"tags":["a"]}\n{"name":"x"}\n',
    });
    const result = runCli([
      files["records.ndjson"],
      "--readonly",
      "--name",
      "Record",
      "--ndjson",
      "--type",
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "export type Record = {",
        "  readonly id?: number;",
        "  readonly tags?: readonly string[];",
        "  readonly name?: string;",
        "};",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("merges array samples and scalar samples as non-object roots", async () => {
    const files = await createFixture({
      "arrays.ndjson": "[1]\n[2]\n",
      "scalars.ndjson": '"x"\n2\nnull\n',
    });
    const arrays = runCli(["--ndjson", files["arrays.ndjson"]]);
    const scalars = runCli(["--ndjson", files["scalars.ndjson"]]);

    expect(arrays).toEqual({
      exitCode: 0,
      stdout: "export type Root = number[];\n",
      stderr: "",
    });
    expect(scalars).toEqual({
      exitCode: 0,
      stdout: "export type Root = string | number | null;\n",
      stderr: "",
    });
  });

  test("rejects mixed object and non-object sample roots without output", async () => {
    const files = await createFixture({ "mixed.ndjson": '[1]\n{"id":1}\n' });
    const result = runCli(["--ndjson", files["mixed.ndjson"]]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "jsonshape: documents mix object and non-object roots\n",
    });
  });

  test("reports the first malformed physical line after counting blank lines", async () => {
    const files = await createFixture({
      "invalid.ndjson": '{"valid":1}\n\n \n{bad\n{"also":}\n',
    });
    const result = runCli(["--ndjson", files["invalid.ndjson"]]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(
      result.stderr.startsWith(`jsonshape: ${files["invalid.ndjson"]}:4: invalid JSON: `),
    ).toBe(true);
    expect(result.stderr.endsWith("\n")).toBe(true);
  });

  test("labels malformed stdin lines as <stdin>", () => {
    const result = runCli(["--ndjson", "-"], '\n{"ok":true}\n{bad\n');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith("jsonshape: <stdin>:3: invalid JSON: ")).toBe(true);
    expect(result.stderr.endsWith("\n")).toBe(true);
  });

  test("reports an invalid line in a later file and emits no partial declaration", async () => {
    const files = await createFixture({
      "first.ndjson": '{"valid":true}\n',
      "second.ndjson": '{"alsoValid":true}\n{bad\n',
    });
    const result = runCli(["--ndjson", files["first.ndjson"], files["second.ndjson"]]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith(`jsonshape: ${files["second.ndjson"]}:2: invalid JSON: `)).toBe(
      true,
    );
    expect(result.stderr.endsWith("\n")).toBe(true);
  });

  test("reports no JSON values for an empty or blank-only collection of inputs", async () => {
    const files = await createFixture({
      "empty.ndjson": "",
      "blank.ndjson": " \n\t\n\r\n",
    });
    const empty = runCli(["--ndjson", files["empty.ndjson"]]);
    const blank = runCli(["--ndjson", files["blank.ndjson"]]);

    expect(empty).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "jsonshape: no JSON values found\n",
    });
    expect(blank).toEqual(empty);
  });

  test("keeps whole-document parsing when --ndjson is absent", async () => {
    const files = await createFixture({ "multiple-values.ndjson": '{"id":1}\n{"id":2}\n' });
    const result = runCli([files["multiple-values.ndjson"]]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(
      result.stderr.startsWith(`jsonshape: ${files["multiple-values.ndjson"]}: invalid JSON: `),
    ).toBe(true);
    expect(result.stderr).not.toContain(`${files["multiple-values.ndjson"]}:1: invalid JSON:`);
    expect(result.stderr.endsWith("\n")).toBe(true);
  });

  test("updates help usage and rejects an option value as an unknown option", () => {
    const help = runCli(["--help"]);
    const invalidFlag = runCli(["--ndjson=1"]);

    expect(help).toEqual({
      exitCode: 0,
      stdout: "Usage: jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--help] FILE...\n",
      stderr: "",
    });
    expect(invalidFlag).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: unknown option: --ndjson=1\n",
    });
  });

  test("documents the NDJSON option, example, and all-inputs-empty error", async () => {
    const readme = (await readFile(new URL("../README.md", import.meta.url), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    const sectionStart = readme.indexOf("## NDJSON input");
    const examplesStart = readme.indexOf("## Examples");
    const section = readme.slice(sectionStart, examplesStart);

    expect(readme).toContain(
      "jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--help] FILE...",
    );
    expect(readme).toContain(
      "| `--ndjson` | Read every input as JSON Lines: one sample per non-blank line. |",
    );
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(examplesStart).toBeGreaterThan(sectionStart);
    expect(section).toContain('```text\n{"id":1,"tags":["a"]}\n\n{"id":2,"name":"x"}\n```');
    expect(section).toContain("bun run src/cli.ts --ndjson events.ndjson");
    expect(section).toContain(
      "```ts\nexport interface Root {\n  id: number;\n  tags?: string[];\n  name?: string;\n}\n```",
    );
    expect(section).toContain("Blank lines are skipped.");
    expect(section).toContain("`FILE:LINE`");
    expect(section).toContain("if all supplied inputs yield no values");
    expect(section).toContain("`no JSON values found`");
  });

  test("the CI workflow runs tests on Windows, macOS, and Linux", async () => {
    const workflow = (
      await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
    ).replace(/\r\n/g, "\n");

    expect(workflow).toContain("os: [ubuntu-latest, windows-latest, macos-latest]");
    expect(workflow).toContain("- run: bun test");
  });
});
