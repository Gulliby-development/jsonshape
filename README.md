<p align="center"><img src="docs/logo.svg" width="96" alt="" /></p>

# jsonshape

jsonshape turns one or more JSON samples into TypeScript declarations. It is for developers who want a quick, readable starting point for types that reflect real API responses or other JSON data. Samples are merged: keys absent from some objects become optional, while differing values become unions.

[![CI](https://github.com/Gulliby-development/jsonshape/actions/workflows/ci.yml/badge.svg)](https://github.com/Gulliby-development/jsonshape/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

Install the project dependencies with Bun:

```sh
bun install
```

The package exposes a `jsonshape` executable. In a checkout, run it with `bun run src/cli.ts`.

`bun pm pack` packs only `src/cli.ts`, `src/jsonshape.ts`, `package.json`, `README.md` and `LICENSE`; the tests are left out.

## Usage

```text
jsonshape [--name ROOT] [--readonly] [--type] [--ndjson] [--indent N|tab] [--examples] [--help] FILE...
```

Pass one or more JSON files. Use `-` for standard input. Options can appear before or after file names. The default root name is `Root`; custom names must begin with an uppercase ASCII letter and contain only ASCII letters and digits.

```sh
bun run src/cli.ts sample.json
cat sample.json | bun run src/cli.ts -
bun run src/cli.ts --name ApiResponse --readonly sample.json
bun run src/cli.ts sample.json --type
```

`--readonly` marks every property readonly and uses readonly array types. `--type` emits type aliases instead of interfaces. `--help` prints usage information.

## Rules

- jsonshape recognizes strings, numbers, booleans, null, objects, and arrays. Values at the same position across samples are merged; array elements share one position.
- Object keys appear in first-seen order. A key is optional if it is missing from any occurrence of that object. Null is a value, not a missing key. Nested keys are assessed only where their parent exists. Special keys such as `__proto__` and `constructor` are ordinary keys.
- Unions use this order: string, number, boolean, null, object type, array type. Each kind appears once.
- Array element types merge across samples. Arrays empty in every sample use `unknown[]`; union elements are parenthesized, and nested arrays keep their nesting.
- An object root produces an exported interface, or an exported object type with `--type`. Non-object roots produce an exported type alias; objects inside root arrays are named with an `Item` suffix. Mixing object and non-object roots is an error.
- Nested object names come from maximal runs of ASCII letters and digits in the key. Split a run where a lowercase letter or digit is followed by an uppercase letter, capitalize the first character of each resulting word, and keep its remaining characters unchanged: `user_name` and `userName` become `UserName`, `v2` becomes `V2`, and `2fa` stays `2fa`. Punctuation and non-ASCII characters are separators; a key with no words adds nothing. An object reached through one or more array layers adds `Item` once. Duplicate generated names receive suffixes `2`, `3`, and so on in print order. Identifier-like property keys are bare; other keys use JSON string quoting.
- Declarations are printed parent-first, with children depth-first in first-seen key order. Properties have two-space indentation and trailing semicolons; declarations have a blank line between them.

## NDJSON input

With `--ndjson`, jsonshape reads each input as JSON Lines, parsing each non-blank line as one sample. For example, `events.ndjson`:

```text
{"id":1,"tags":["a"]}

{"id":2,"name":"x"}
```

Run:

```sh
bun run src/cli.ts --ndjson events.ndjson
```

Output:

```ts
export interface Root {
  id: number;
  tags?: string[];
  name?: string;
}
```

Blank lines are skipped. Invalid-line errors identify the source and physical line as `FILE:LINE`. An input with no value is allowed if another supplied input has values; if all supplied inputs yield no values, jsonshape reports `no JSON values found`.

## Sample values

`--examples` adds a comment ` // e.g. VALUE` at the end of a property line. VALUE is the JSON text of the first string, number or boolean that appeared directly as the value of that property, in input order across all samples (elements of arrays are not used). A property whose merged type has no such value (objects, arrays, null) gets no comment, and neither does one whose JSON text is longer than 30 characters or contains U+2028 or U+2029. The option takes no value, may stand anywhere among the arguments, and changes nothing else in the output. For example, `sample.json`:

```json
{"id":1,"name":"Ann","tags":["a"],"address":{"city":"X"},"bio":"a rather long text of more than thirty characters"}
```

Run:

```sh
bun run src/cli.ts --examples sample.json
```

Output:

```ts
export interface Root {
  id: number; // e.g. 1
  name: string; // e.g. "Ann"
  tags: string[];
  address: RootAddress;
  bio: string;
}

export interface RootAddress {
  city: string; // e.g. "X"
}
```

## Indentation

`--indent N|tab` sets the indentation of the properties: N is a single digit from 1 to 8 (that many spaces) or the word `tab` (one tab character). The default is two spaces. Only property lines change; declaration lines and the blank lines between declarations stay as they are. When the option is repeated, the last one wins. A missing value (the last argument, or a next argument starting with `--`) is the usage error `--indent needs a value`; any other value is the usage error `invalid --indent: VALUE`. For example, `sample.json`:

```json
{"id":1,"tags":["a"],"address":{"city":"X"}}
```

Run:

```sh
bun run src/cli.ts --indent 4 sample.json
```

Output:

```ts
export interface Root {
    id: number;
    tags: string[];
    address: RootAddress;
}

export interface RootAddress {
    city: string;
}
```

## Examples

### Example: Merge object samples

Flags: none

```json
{"id":1,"name":"Ann","tags":["a","b"],"address":{"city":"X","zip":null}}
```

```json
{"id":2,"name":null,"tags":[],"address":{"city":"Y"},"admin":true}
```

```ts
export interface Root {
  id: number;
  name: string | null;
  tags: string[];
  address: RootAddress;
  admin?: boolean;
}

export interface RootAddress {
  city: string;
  zip?: null;
}
```

### Example: Objects inside a root array

Flags: none

```json
[{"a":1},{"a":"x","b":[{"c":true}]}]
```

```ts
export interface RootItem {
  a: string | number;
  b?: RootItemBItem[];
}

export interface RootItemBItem {
  c: boolean;
}

export type Root = RootItem[];
```

### Example: Readonly properties and arrays

Flags: --readonly

```json
{"id":1,"tags":[["x"]]}
```

```ts
export interface Root {
  readonly id: number;
  readonly tags: readonly (readonly string[])[];
}
```

## Exit codes

- `0`: successful generation or `--help`.
- `1`: unreadable input, invalid JSON, no JSON values, or mixed object and non-object roots.
- `2`: usage error, such as no input files, an unknown option, or an invalid/missing root name.

Errors are written to standard error with the `jsonshape: ` prefix. Inputs are read and parsed before declarations are written, so a failed input does not produce partial output.

## Development

This project uses Bun, strict TypeScript, and Biome, with no runtime dependencies.

```sh
bun install
bun run typecheck
bun run lint
bun test
```

### Options

| Option | Description |
|---|---|
| `--name ROOT` | Root declaration name (default `Root`; uppercase ASCII letter, then ASCII letters and digits). |
| `--readonly` | Mark properties readonly and use readonly array types. |
| `--type` | Emit type aliases instead of interfaces. |
| `--ndjson` | Read every input as JSON Lines: one sample per non-blank line. |
| `--indent N\|tab` | Indent properties with N spaces (1 to 8) or one tab; default two spaces. |
| `--examples` | Add an `// e.g. VALUE` comment with a sample value to properties that have one. |
| `--help` | Print usage information. |
| `-` | Read one sample from standard input. |

## License

MIT, see [LICENSE](LICENSE).

---

Built with BAKED, an open-source coding agent (bench loop round 6, BAKED 384fef1).
