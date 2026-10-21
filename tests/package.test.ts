import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("package manifest", () => {
  test("lists exactly the two runtime files and keeps the rest of the manifest", async () => {
    const manifest = JSON.parse(await readFile(`${root}package.json`, "utf8")) as Record<
      string,
      unknown
    >;

    expect(manifest.files).toEqual(["src/cli.ts", "src/jsonshape.ts"]);
    expect(manifest.name).toBe("jsonshape");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.private).toBe(true);
    expect(manifest.bin).toEqual({ jsonshape: "src/cli.ts" });
  });

  test("a dry-run pack contains only the runtime files and the always-included ones", () => {
    const result = Bun.spawnSync([process.execPath, "pm", "pack", "--dry-run"], { cwd: root });
    const output = result.stdout.toString();
    const packed = [...output.matchAll(/^packed \S+ (.+)$/gm)].map((match) => match[1]);

    expect(result.exitCode).toBe(0);
    expect(packed.sort()).toEqual([
      "LICENSE",
      "README.md",
      "package.json",
      "src/cli.ts",
      "src/jsonshape.ts",
    ]);
    expect(output).toContain("Total files: 5");
  });

  test("the README says what a packed package holds", async () => {
    const readme = await readFile(`${root}README.md`, "utf8");

    expect(readme).toContain(
      "`bun pm pack` packs only `src/cli.ts`, `src/jsonshape.ts`, `package.json`, `README.md` and `LICENSE`; the tests are left out.",
    );
  });
});
