import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { generateTypeScript } from "../src/jsonshape";

const sample = { id: 1, tags: ["a"], address: { city: "X" } };

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

function sampleOutput(indent: string): string {
  return [
    "export interface Root {",
    `${indent}id: number;`,
    `${indent}tags: string[];`,
    `${indent}address: RootAddress;`,
    "}",
    "",
    "export interface RootAddress {",
    `${indent}city: string;`,
    "}",
  ].join("\n");
}

describe("configurable indentation", () => {
  test("keeps the default two-space library output", () => {
    expect(generateTypeScript([sample])).toBe(sampleOutput("  "));
  });

  test("uses exact custom library prefixes on property lines only", () => {
    for (const indent of ["    ", "\t", " "]) {
      expect(generateTypeScript([sample], { indent })).toBe(sampleOutput(indent));
    }
  });

  test("indents properties in array-item and nested object declarations", () => {
    expect(generateTypeScript([[{ a: 1, child: { ok: true } }]], { indent: "   " })).toBe(
      [
        "export interface RootItem {",
        "   a: number;",
        "   child: RootItemChild;",
        "}",
        "",
        "export interface RootItemChild {",
        "   ok: boolean;",
        "}",
        "",
        "export type Root = RootItem[];",
      ].join("\n"),
    );
  });

  test("leaves non-object roots and empty object declarations unchanged", () => {
    expect(generateTypeScript([5], { indent: "    " })).toBe("export type Root = number;");
    expect(generateTypeScript([{}], { indent: "\t" })).toBe("export interface Root {}");
  });

  test("renders the default, every supported space count, and tab in the CLI", () => {
    const cases = [
      { value: undefined, indent: "  " },
      ...Array.from({ length: 8 }, (_, index) => {
        const value = String(index + 1);
        return { value, indent: " ".repeat(index + 1) };
      }),
      { value: "tab", indent: "\t" },
    ];

    for (const { value, indent } of cases) {
      const args = value === undefined ? ["-"] : ["--indent", value, "-"];
      const result = runCli(args, JSON.stringify(sample));

      expect(result).toEqual({
        exitCode: 0,
        stdout: `${sampleOutput(indent)}\n`,
        stderr: "",
      });
    }
  });

  test("combines indentation with a custom name, readonly properties, and type output", () => {
    const result = runCli(
      ["--name", "ApiResponse", "--indent", "4", "--readonly", "--type", "-"],
      JSON.stringify(sample),
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "export type ApiResponse = {",
        "    readonly id: number;",
        "    readonly tags: readonly string[];",
        "    readonly address: ApiResponseAddress;",
        "};",
        "",
        "export type ApiResponseAddress = {",
        "    readonly city: string;",
        "};",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("combines indentation with NDJSON samples", () => {
    const result = runCli(
      ["--ndjson", "--indent", "4", "-"],
      '{"id":1,"tags":["a"],"address":{"city":"X"}}\n{"id":2,"name":"x","address":{"city":"Y"}}\n',
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "export interface Root {",
        "    id: number;",
        "    tags?: string[];",
        "    address: RootAddress;",
        "    name?: string;",
        "}",
        "",
        "export interface RootAddress {",
        "    city: string;",
        "}",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("accepts indentation before and after the input token", () => {
    const before = runCli(["--indent", "3", "-"], '{"id":1}');
    const after = runCli(["-", "--indent", "1"], '{"id":1}');

    expect(before).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n   id: number;\n}\n",
      stderr: "",
    });
    expect(after).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n id: number;\n}\n",
      stderr: "",
    });
  });

  test("uses the last repeated indentation option", () => {
    const lastTab = runCli(["--indent", "4", "--indent", "tab", "-"], '{"id":1}');
    const lastSpace = runCli(["--indent", "tab", "--indent", "1", "-"], '{"id":1}');

    expect(lastTab.stdout).toBe("export interface Root {\n\tid: number;\n}\n");
    expect(lastSpace.stdout).toBe("export interface Root {\n id: number;\n}\n");
    expect(lastTab.exitCode).toBe(0);
    expect(lastTab.stderr).toBe("");
    expect(lastSpace.exitCode).toBe(0);
    expect(lastSpace.stderr).toBe("");
  });

  test("keeps CLI output unchanged for a number root and an empty object", () => {
    const number = runCli(["--indent", "4", "-"], "5");
    const emptyObject = runCli(["--indent", "4", "-"], "{}");

    expect(number).toEqual({
      exitCode: 0,
      stdout: "export type Root = number;\n",
      stderr: "",
    });
    expect(emptyObject).toEqual({
      exitCode: 0,
      stdout: "export interface Root {}\n",
      stderr: "",
    });
  });

  test("reports missing values before checking for input files", () => {
    const atEnd = runCli(["--indent"]);
    const beforeOption = runCli(["--indent", "--type", "a.json"]);

    expect(atEnd).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: --indent needs a value\n",
    });
    expect(beforeOption).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: --indent needs a value\n",
    });
  });

  test("rejects invalid values and the equals form with usage errors", () => {
    for (const value of ["0", "9", "10", "04", "-2", "TAB", "x"]) {
      expect(runCli(["--indent", value])).toEqual({
        exitCode: 2,
        stdout: "",
        stderr: `jsonshape: invalid --indent: ${value}\n`,
      });
    }

    expect(runCli(["--indent=x"])).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: unknown option: --indent=x\n",
    });
  });

  test("documents the exact usage, option row, and indentation section", async () => {
    const readme = (await readFile(new URL("../README.md", import.meta.url), "utf8"))
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "");
    const usage =
      "jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--indent N|tab] [--help] FILE...";
    const optionRow =
      "| `--indent N\\|tab` | Indent properties with N spaces (1 to 8) or one tab; default two spaces. |";
    const ndjsonRow =
      "| `--ndjson` | Read every input as JSON Lines: one sample per non-blank line. |";
    const sectionStart = readme.indexOf("## Indentation");
    const examplesStart = readme.indexOf("## Examples");
    const expectedSection = [
      "## Indentation",
      "",
      "`--indent N|tab` sets the indentation of the properties: N is a single digit from 1 to 8 (that many spaces) or the word `tab` (one tab character). The default is two spaces. Only property lines change; declaration lines and the blank lines between declarations stay as they are. When the option is repeated, the last one wins. A missing value (the last argument, or a next argument starting with `--`) is the usage error `--indent needs a value`; any other value is the usage error `invalid --indent: VALUE`. For example, `sample.json`:",
      "",
      "```json",
      '{"id":1,"tags":["a"],"address":{"city":"X"}}',
      "```",
      "",
      "Run:",
      "",
      "```sh",
      "bun run src/cli.ts --indent 4 sample.json",
      "```",
      "",
      "Output:",
      "",
      "```ts",
      "export interface Root {",
      "    id: number;",
      "    tags: string[];",
      "    address: RootAddress;",
      "}",
      "",
      "export interface RootAddress {",
      "    city: string;",
      "}",
      "```",
      "",
      "",
    ].join("\n");

    expect(readme).toContain(usage);
    expect(readme).toContain(optionRow);
    expect(readme.indexOf(optionRow)).toBeGreaterThan(readme.indexOf(ndjsonRow));
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(examplesStart).toBeGreaterThan(sectionStart);
    expect(readme.slice(sectionStart, examplesStart)).toBe(expectedSection);
  });
});
