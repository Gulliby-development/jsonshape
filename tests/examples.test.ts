import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateTypeScript } from "../src/jsonshape";

let tempDir: string;
let samplePath: string;
let firstDocumentPath: string;
let secondDocumentPath: string;
let firstNdjsonPath: string;
let secondNdjsonPath: string;

const sampleJson =
  '{"id":1,"name":"Ann","tags":["a"],"address":{"city":"X"},"bio":"a rather long text of more than thirty characters"}';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "jsonshape-examples-"));
  samplePath = join(tempDir, "sample.json");
  firstDocumentPath = join(tempDir, "first.json");
  secondDocumentPath = join(tempDir, "second.json");
  firstNdjsonPath = join(tempDir, "first.ndjson");
  secondNdjsonPath = join(tempDir, "second.ndjson");

  writeFileSync(samplePath, sampleJson);
  writeFileSync(firstDocumentPath, '{"value":1}');
  writeFileSync(secondDocumentPath, '{"value":"x"}');
  writeFileSync(firstNdjsonPath, '{"value":1}\n{"value":"x"}\n');
  writeFileSync(secondNdjsonPath, '{"value":false}\n{"value":2}\n');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

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

function lines(values: string[]): string {
  return values.join("\n");
}

function readReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

describe("optional property examples", () => {
  test("keeps the first primitive when later samples add a different kind", () => {
    expect(generateTypeScript([{ value: 1 }, { value: "x" }], { examples: true })).toBe(
      lines(["export interface Root {", "  value: string | number; // e.g. 1", "}"]),
    );
  });

  test("follows document order and first-seen property order", () => {
    expect(
      generateTypeScript(
        [
          { z: 1, a: 2 },
          { a: "first", b: true },
        ],
        { examples: true },
      ),
    ).toBe(
      lines([
        "export interface Root {",
        "  z?: number; // e.g. 1",
        "  a: string | number; // e.g. 2",
        "  b?: boolean; // e.g. true",
        "}",
      ]),
    );
    expect(
      generateTypeScript(
        [
          { a: "first", b: true },
          { z: 3, a: 2 },
        ],
        { examples: true },
      ),
    ).toBe(
      lines([
        "export interface Root {",
        '  a: string | number; // e.g. "first"',
        "  b?: boolean; // e.g. true",
        "  z?: number; // e.g. 3",
        "}",
      ]),
    );
  });

  test("adds an example to an optional property", () => {
    expect(generateTypeScript([{}, { b: 5 }], { examples: true })).toBe(
      lines(["export interface Root {", "  b?: number; // e.g. 5", "}"]),
    );
  });

  test("treats false as a candidate after null and keeps the first boolean", () => {
    expect(
      generateTypeScript(
        [
          { value: null, flag: false, truth: true },
          { value: false, flag: true, truth: false },
        ],
        { examples: true },
      ),
    ).toBe(
      lines([
        "export interface Root {",
        "  value: boolean | null; // e.g. false",
        "  flag: boolean; // e.g. false",
        "  truth: boolean; // e.g. true",
        "}",
      ]),
    );
  });

  test("does not use composite values or array elements as examples", () => {
    expect(
      generateTypeScript([{ items: [1], record: { child: true }, missing: null }], {
        examples: true,
      }),
    ).toBe(
      lines([
        "export interface Root {",
        "  items: number[];",
        "  record: RootRecord;",
        "  missing: null;",
        "}",
        "",
        "export interface RootRecord {",
        "  child: boolean; // e.g. true",
        "}",
      ]),
    );
  });

  test("finds the first eligible value after composites and never overwrites it", () => {
    expect(
      generateTypeScript(
        [
          { afterArray: [], afterObject: {}, beforeComposite: 1 },
          { afterArray: false, afterObject: null, beforeComposite: [] },
          { afterArray: {}, afterObject: 4, beforeComposite: {} },
        ],
        { examples: true },
      ),
    ).toBe(
      lines([
        "export interface Root {",
        "  afterArray: boolean | RootAfterArray | unknown[]; // e.g. false",
        "  afterObject: number | null | RootAfterObject; // e.g. 4",
        "  beforeComposite: number | RootBeforeComposite | unknown[]; // e.g. 1",
        "}",
        "",
        "export interface RootAfterArray {}",
        "",
        "export interface RootAfterObject {}",
        "",
        "export interface RootBeforeComposite {}",
      ]),
    );
  });

  test("retains examples for object properties inside root arrays", () => {
    expect(generateTypeScript([[{ v: 1 }], [{ v: "x" }]], { examples: true })).toBe(
      lines([
        "export interface RootItem {",
        "  v: string | number; // e.g. 1",
        "}",
        "",
        "export type Root = RootItem[];",
      ]),
    );
  });

  test("leaves non-object roots without property comments", () => {
    expect(generateTypeScript([42], { examples: true })).toBe("export type Root = number;");
    expect(generateTypeScript([null], { examples: true })).toBe("export type Root = null;");
    expect(generateTypeScript([[1]], { examples: true })).toBe("export type Root = number[];");
  });

  test("includes JSON text of length 29 and 30 but suppresses 31 permanently", () => {
    const twentyNine = "a".repeat(27);
    const thirty = "b".repeat(28);
    const thirtyOne = "c".repeat(29);
    expect(JSON.stringify(twentyNine).length).toBe(29);
    expect(JSON.stringify(thirty).length).toBe(30);
    expect(JSON.stringify(thirtyOne).length).toBe(31);

    expect(
      generateTypeScript([{ twentyNine, thirty, thirtyOne }, { thirtyOne: "short" }], {
        examples: true,
      }),
    ).toBe(
      lines([
        "export interface Root {",
        `  twentyNine?: string; // e.g. ${JSON.stringify(twentyNine)}`,
        `  thirty?: string; // e.g. ${JSON.stringify(thirty)}`,
        "  thirtyOne: string;",
        "}",
      ]),
    );
  });

  test("counts JSON escaping in the serialized-length limit", () => {
    const value = "\\".repeat(14);
    expect(JSON.stringify(value).length).toBe(30);
    expect(generateTypeScript([{ value }], { examples: true })).toBe(
      lines(["export interface Root {", `  value: string; // e.g. ${JSON.stringify(value)}`, "}"]),
    );
  });

  test("counts surrogate pairs as two UTF-16 code units", () => {
    const safe = "\u{1f600}".repeat(14);
    const tooLong = `${safe}x`;
    expect(JSON.stringify(safe).length).toBe(30);
    expect(JSON.stringify(tooLong).length).toBe(31);
    expect(generateTypeScript([{ safe, tooLong }], { examples: true })).toBe(
      lines([
        "export interface Root {",
        `  safe: string; // e.g. ${JSON.stringify(safe)}`,
        "  tooLong: string;",
        "}",
      ]),
    );
  });

  test("suppresses U+2028 even when a later safe candidate exists", () => {
    expect(generateTypeScript([{ value: "\u2028" }, { value: "safe" }], { examples: true })).toBe(
      lines(["export interface Root {", "  value: string;", "}"]),
    );
  });

  test("suppresses U+2029 even when a later safe candidate exists", () => {
    expect(generateTypeScript([{ value: "\u2029" }, { value: "safe" }], { examples: true })).toBe(
      lines(["export interface Root {", "  value: string;", "}"]),
    );
  });

  test("uses JSON escaping for quotes, backslashes, and tabs", () => {
    const value = 'quote " slash \\ tab\t';
    expect(generateTypeScript([{ value }], { examples: true })).toBe(
      lines(["export interface Root {", `  value: string; // e.g. ${JSON.stringify(value)}`, "}"]),
    );
  });

  test("prints JavaScript number forms and both boolean values", () => {
    const longInteger = JSON.parse('{"value":12345678901234567890}') as { value: number };
    expect(
      generateTypeScript(
        [
          {
            fraction: -0.5,
            exponent: 1e21,
            negativeZero: -0,
            large: longInteger.value,
            no: false,
            yes: true,
          },
        ],
        { examples: true },
      ),
    ).toBe(
      lines([
        "export interface Root {",
        "  fraction: number; // e.g. -0.5",
        "  exponent: number; // e.g. 1e+21",
        "  negativeZero: number; // e.g. 0",
        "  large: number; // e.g. 12345678901234567000",
        "  no: boolean; // e.g. false",
        "  yes: boolean; // e.g. true",
        "}",
      ]),
    );
  });

  test("puts comments after quoted property names and their semicolons", () => {
    const sample = JSON.parse('{"a-b":"x","has space":true}') as Record<string, unknown>;
    expect(generateTypeScript([sample], { examples: true })).toBe(
      lines([
        "export interface Root {",
        '  "a-b": string; // e.g. "x"',
        '  "has space": boolean; // e.g. true',
        "}",
      ]),
    );
  });

  test("combines examples with a custom name, readonly, type, and indentation", () => {
    expect(
      generateTypeScript([{ user: { "a-b": 1 } }], {
        name: "Request",
        readonly: true,
        type: true,
        indent: "    ",
        examples: true,
      }),
    ).toBe(
      lines([
        "export type Request = {",
        "    readonly user: RequestUser;",
        "};",
        "",
        "export type RequestUser = {",
        '    readonly "a-b": number; // e.g. 1',
        "};",
      ]),
    );
  });

  test("keeps library output byte-identical when examples are omitted or false", () => {
    const sample = [{ id: 1, name: "Ann" }];
    const expected = lines(["export interface Root {", "  id: number;", "  name: string;", "}"]);
    const absent = generateTypeScript(sample);
    expect(absent).toBe(expected);
    expect(generateTypeScript(sample, { examples: false })).toBe(absent);
  });

  test("matches the exact sample.json worked output", () => {
    expect(
      generateTypeScript(
        [
          {
            id: 1,
            name: "Ann",
            tags: ["a"],
            address: { city: "X" },
            bio: "a rather long text of more than thirty characters",
          },
        ],
        { examples: true },
      ),
    ).toBe(
      lines([
        "export interface Root {",
        "  id: number; // e.g. 1",
        '  name: string; // e.g. "Ann"',
        "  tags: string[];",
        "  address: RootAddress;",
        "  bio: string;",
        "}",
        "",
        "export interface RootAddress {",
        '  city: string; // e.g. "X"',
        "}",
      ]),
    );
  });

  test("matches root-array examples in default and combined output", () => {
    expect(generateTypeScript([[{ v: 1 }, { v: "x" }]], { examples: true })).toBe(
      lines([
        "export interface RootItem {",
        "  v: string | number; // e.g. 1",
        "}",
        "",
        "export type Root = RootItem[];",
      ]),
    );
    expect(
      generateTypeScript([[{ v: -0.5, w: 1e21, s: "tab\there" }]], {
        examples: true,
        type: true,
        readonly: true,
      }),
    ).toBe(
      lines([
        "export type RootItem = {",
        "  readonly v: number; // e.g. -0.5",
        "  readonly w: number; // e.g. 1e+21",
        '  readonly s: string; // e.g. "tab\\there"',
        "};",
        "",
        "export type Root = readonly RootItem[];",
      ]),
    );
  });

  test("prints the supplied CLI sample.json output exactly", () => {
    const result = runCli(["--examples", samplePath]);
    expect(result).toEqual({
      exitCode: 0,
      stdout:
        "export interface Root {\n" +
        "  id: number; // e.g. 1\n" +
        '  name: string; // e.g. "Ann"\n' +
        "  tags: string[];\n" +
        "  address: RootAddress;\n" +
        "  bio: string;\n" +
        "}\n\n" +
        "export interface RootAddress {\n" +
        '  city: string; // e.g. "X"\n' +
        "}\n",
      stderr: "",
    });
  });

  test("keeps legacy CLI output unchanged when the flag is absent", () => {
    expect(runCli(["-"], '{"id":1,"name":"Ann"}')).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n  id: number;\n  name: string;\n}\n",
      stderr: "",
    });
  });

  test("safely handles actual UTF-8 U+2028 and U+2029 on CLI stdin", () => {
    const input = JSON.stringify({
      line: "\u2028",
      paragraph: "\u2029",
      safe: "ok",
    });
    expect(input.includes("\u2028")).toBe(true);
    expect(input.includes("\u2029")).toBe(true);
    expect(runCli(["--examples", "-"], input)).toEqual({
      exitCode: 0,
      stdout:
        'export interface Root {\n  line: string;\n  paragraph: string;\n  safe: string; // e.g. "ok"\n}\n',
      stderr: "",
    });
  });

  test("accepts the flag before, between, and after files, including repeats", () => {
    const expected = {
      exitCode: 0,
      stdout: "export interface Root {\n  value: string | number; // e.g. 1\n}\n",
      stderr: "",
    };
    const variants = [
      ["--examples", firstDocumentPath, secondDocumentPath],
      [firstDocumentPath, "--examples", secondDocumentPath],
      [firstDocumentPath, secondDocumentPath, "--examples"],
      ["--examples", firstDocumentPath, "--examples", secondDocumentPath, "--examples"],
    ];
    for (const args of variants) expect(runCli(args)).toEqual(expected);
  });

  test("rejects an examples option value as an unknown option", () => {
    expect(runCli(["--examples=1"])).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: unknown option: --examples=1\n",
    });
  });

  test("prints the exact updated help usage", () => {
    expect(runCli(["--help"])).toEqual({
      exitCode: 0,
      stdout:
        "Usage: jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--indent N|tab] [--examples] [--help] FILE...\n",
      stderr: "",
    });
  });

  test("combines CLI examples with readonly, type, name, and custom indentation", () => {
    expect(
      runCli(
        ["--examples", "--name", "Payload", "--readonly", "--type", "--indent", "tab", "-"],
        '{"value":-0.5,"label":"x"}',
      ),
    ).toEqual({
      exitCode: 0,
      stdout:
        "export type Payload = {\n" +
        "\treadonly value: number; // e.g. -0.5\n" +
        '\treadonly label: string; // e.g. "x"\n' +
        "};\n",
      stderr: "",
    });
  });

  test("keeps first-candidate order across multiple NDJSON files", () => {
    expect(runCli(["--ndjson", firstNdjsonPath, "--examples", secondNdjsonPath])).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n  value: string | number | boolean; // e.g. 1\n}\n",
      stderr: "",
    });
  });

  test("documents the exact usage, option row, and section order", () => {
    const markdown = readReadme();
    const usage =
      "jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--indent N|tab] [--examples] [--help] FILE...";
    const option =
      "| `--examples` | Add an `// e.g. VALUE` comment with a sample value to properties that have one. |";
    const helpOption = "| `--help` | Print usage information. |";

    expect(markdown).toContain(lines(["## Usage", "", "```text", usage, "```"]));
    expect(markdown).toContain(`${option}\n${helpOption}`);
    expect(markdown.indexOf("## NDJSON input")).toBeLessThan(markdown.indexOf("## Sample values"));
    expect(markdown.indexOf("## Sample values")).toBeLessThan(markdown.indexOf("## Indentation"));
    expect(markdown.indexOf("## Indentation")).toBeLessThan(markdown.indexOf("## Examples"));
  });

  test("documents the supplied Sample values section verbatim", () => {
    const markdown = readReadme();
    const start = markdown.indexOf("## Sample values\n");
    const end = markdown.indexOf("\n## Indentation", start);
    const actual = markdown.slice(start, end);
    const expected = lines([
      "## Sample values",
      "",
      "`--examples` adds a comment ` // e.g. VALUE` at the end of a property line. VALUE is the JSON text of the first string, number or boolean that appeared directly as the value of that property, in input order across all samples (elements of arrays are not used). A property whose merged type has no such value (objects, arrays, null) gets no comment, and neither does one whose JSON text is longer than 30 characters or contains U+2028 or U+2029. The option takes no value, may stand anywhere among the arguments, and changes nothing else in the output. For example, `sample.json`:",
      "",
      "```json",
      '{"id":1,"name":"Ann","tags":["a"],"address":{"city":"X"},"bio":"a rather long text of more than thirty characters"}',
      "```",
      "",
      "Run:",
      "",
      "```sh",
      "bun run src/cli.ts --examples sample.json",
      "```",
      "",
      "Output:",
      "",
      "```ts",
      "export interface Root {",
      "  id: number; // e.g. 1",
      '  name: string; // e.g. "Ann"',
      "  tags: string[];",
      "  address: RootAddress;",
      "  bio: string;",
      "}",
      "",
      "export interface RootAddress {",
      '  city: string; // e.g. "X"',
      "}",
      "```",
    ]);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(actual).toBe(`${expected}\n`);
  });
});
