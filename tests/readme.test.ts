import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { generateTypeScript } from "../src/jsonshape";

interface ReadmeExample {
  title: string;
  flags: string[];
  samples: unknown[];
  expected: string;
}

function parseExamples(markdown: string): ReadmeExample[] {
  const sections = markdown
    .split(/(?=^### Example: )/m)
    .filter((section) => section.startsWith("### Example: "));
  return sections.map((section) => {
    const title = section.match(/^### Example: (.+)$/m)?.[1];
    const flagLine = section.match(/^Flags: (.+)$/m)?.[1];
    if (!title || !flagLine) throw new Error("README example must have a title and Flags line");

    const blocks = [...section.matchAll(/```(json|ts)\n([\s\S]*?)\n```/g)];
    const samples = blocks
      .filter((block) => block[1] === "json")
      .map((block) => JSON.parse(block[2] as string) as unknown);
    const outputs = blocks.filter((block) => block[1] === "ts");
    if (samples.length === 0 || outputs.length !== 1) {
      throw new Error(
        `README example "${title}" must have JSON sample(s) and exactly one TypeScript output`,
      );
    }

    return {
      title,
      flags: flagLine === "none" ? [] : flagLine.split(/\s+/),
      samples,
      expected: outputs[0]?.[2] as string,
    };
  });
}

describe("README examples", () => {
  test("each documented output matches the library exactly", async () => {
    const markdown = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const examples = parseExamples(markdown);

    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const example of examples) {
      const options = {
        readonly: example.flags.includes("--readonly"),
        type: example.flags.includes("--type"),
      };
      expect(generateTypeScript(example.samples, options)).toBe(example.expected);
    }
  });
});
