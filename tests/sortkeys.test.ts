import { describe, expect, test } from "bun:test";
import { generateTypeScript } from "../src/jsonshape";

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

describe("sortKeys option", () => {
  test("keeps first-seen order without the option", () => {
    expect(generateTypeScript([{ b: 1, a: 2 }])).toBe(
      "export interface Root {\n  b: number;\n  a: number;\n}",
    );
  });

  test("sorts the keys of the root object", () => {
    expect(generateTypeScript([{ b: 1, a: 2, c: true }], { sortKeys: true })).toBe(
      "export interface Root {\n  a: number;\n  b: number;\n  c: boolean;\n}",
    );
  });

  test("sorts by UTF-16 code unit: upper case first, a10 before a2", () => {
    expect(generateTypeScript([{ a2: 1, a10: 1, B: 1, a: 1 }], { sortKeys: true })).toBe(
      "export interface Root {\n  B: number;\n  a: number;\n  a10: number;\n  a2: number;\n}",
    );
  });

  test("sorts the keys of nested objects and orders the declarations the same way", () => {
    expect(
      generateTypeScript([{ zeta: { y: 1, x: 2 }, alpha: { q: 1 } }], { sortKeys: true }),
    ).toBe(
      [
        "export interface Root {",
        "  alpha: RootAlpha;",
        "  zeta: RootZeta;",
        "}",
        "",
        "export interface RootAlpha {",
        "  q: number;",
        "}",
        "",
        "export interface RootZeta {",
        "  x: number;",
        "  y: number;",
        "}",
      ].join("\n"),
    );
  });

  test("sorts the keys of objects inside arrays and keeps optional markers", () => {
    const output = generateTypeScript(
      [
        [
          { b: 1, a: 1 },
          { c: 1, a: 1 },
        ],
      ],
      { sortKeys: true },
    );
    expect(output).toContain("  a: number;\n  b?: number;\n  c?: number;\n");
  });

  test("sorts the keys in a type alias with readonly and examples", () => {
    expect(
      generateTypeScript([{ b: "x", a: 1 }], {
        sortKeys: true,
        type: true,
        readonly: true,
        examples: true,
      }),
    ).toBe(
      'export type Root = {\n  readonly a: number; // e.g. 1\n  readonly b: string; // e.g. "x"\n};',
    );
  });

  test("names colliding declarations in sorted order", () => {
    const sorted = generateTypeScript([{ a_b: { x: 1 }, aB: { y: 1 } }], { sortKeys: true });
    expect(sorted.indexOf("RootAB {")).toBeLessThan(sorted.indexOf("RootAB2 {"));
    expect(sorted).toContain("RootAB {\n  y: number;\n}");
  });
});

describe("--sort-keys on the command line", () => {
  test("sorts the keys of a sample read from standard input", () => {
    expect(runCli(["--sort-keys", "-"], '{"b":1,"a":2}')).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n  a: number;\n  b: number;\n}\n",
      stderr: "",
    });
  });

  test("may stand anywhere among the arguments and combines with other options", () => {
    expect(runCli(["--readonly", "-", "--sort-keys", "--indent", "tab"], '{"b":1,"a":2}')).toEqual({
      exitCode: 0,
      stdout: "export interface Root {\n\treadonly a: number;\n\treadonly b: number;\n}\n",
      stderr: "",
    });
  });

  test("rejects a value glued to the option as an unknown option", () => {
    expect(runCli(["--sort-keys=1", "-"], "{}")).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "jsonshape: unknown option: --sort-keys=1\n",
    });
  });
});
