import { describe, expect, test } from "bun:test";
import { generateTypeScript } from "../src/jsonshape";

describe("generateTypeScript", () => {
  test("merges samples with unions, first-seen keys, and optional nested properties", () => {
    const actual = generateTypeScript([
      { id: 1, name: "Ann", tags: ["a", "b"], address: { city: "X", zip: null } },
      { id: 2, name: null, tags: [], address: { city: "Y" }, admin: true },
    ]);
    expect(actual).toBe(
      [
        "export interface Root {",
        "  id: number;",
        "  name: string | null;",
        "  tags: string[];",
        "  address: RootAddress;",
        "  admin?: boolean;",
        "}",
        "",
        "export interface RootAddress {",
        "  city: string;",
        "  zip?: null;",
        "}",
      ].join("\n"),
    );
  });

  test("merges array elements across samples, including object optionality", () => {
    expect(generateTypeScript([[{ a: 1 }], [{ a: "x", b: [{ c: true }] }]])).toBe(
      [
        "export interface RootItem {",
        "  a: string | number;",
        "  b?: RootItemBItem[];",
        "}",
        "",
        "export interface RootItemBItem {",
        "  c: boolean;",
        "}",
        "",
        "export type Root = RootItem[];",
      ].join("\n"),
    );
  });

  test("judges nested keys only over existing parent objects", () => {
    expect(
      generateTypeScript([{ parent: { present: 1 } }, {}, { parent: { present: 2, later: true } }]),
    ).toBe(
      [
        "export interface Root {",
        "  parent?: RootParent;",
        "}",
        "",
        "export interface RootParent {",
        "  present: number;",
        "  later?: boolean;",
        "}",
      ].join("\n"),
    );
  });

  test("prints each kind once in the prescribed union order", () => {
    expect(
      generateTypeScript([
        { value: "x" },
        { value: 2 },
        { value: true },
        { value: null },
        { value: [] },
        { value: {} },
      ]),
    ).toBe(
      [
        "export interface Root {",
        "  value: string | number | boolean | null | RootValue | unknown[];",
        "}",
        "",
        "export interface RootValue {}",
      ].join("\n"),
    );
  });

  test("renders nested arrays, union elements, and empty arrays", () => {
    expect(generateTypeScript([{ mixed: [1, "x"], nested: [[1]], empty: [] }])).toBe(
      [
        "export interface Root {",
        "  mixed: (string | number)[];",
        "  nested: number[][];",
        "  empty: unknown[];",
        "}",
      ].join("\n"),
    );
  });

  test("renders readonly properties and parenthesizes readonly array elements", () => {
    expect(generateTypeScript([{ values: [[1]], union: [1, "x"] }], { readonly: true })).toBe(
      [
        "export interface Root {",
        "  readonly values: readonly (readonly number[])[];",
        "  readonly union: readonly (string | number)[];",
        "}",
      ].join("\n"),
    );
  });

  test("supports type declarations for object roots and nested objects", () => {
    expect(generateTypeScript([{ user: { id: 1 } }], { type: true })).toBe(
      [
        "export type Root = {",
        "  user: RootUser;",
        "};",
        "",
        "export type RootUser = {",
        "  id: number;",
        "};",
      ].join("\n"),
    );
  });

  test("renders non-object roots as a final alias and names array objects", () => {
    expect(generateTypeScript([[{ ok: true }], null], { name: "Payload" })).toBe(
      [
        "export interface PayloadItem {",
        "  ok: boolean;",
        "}",
        "",
        "export type Payload = null | PayloadItem[];",
      ].join("\n"),
    );
  });

  test("rejects mixed object and non-object roots", () => {
    expect(() => generateTypeScript([{}, []])).toThrow("documents mix object and non-object roots");
  });

  test("names objects in PascalCase and resolves collisions in print order", () => {
    expect(
      generateTypeScript([
        {
          "a-b": { first: true },
          a_b: { second: true },
          userName: { third: true },
          v2: { fourth: true },
          "2fa": { fifth: true },
          é: { sixth: true },
        },
      ]),
    ).toBe(
      [
        "export interface Root {",
        '  "a-b": RootAB;',
        "  a_b: RootAB2;",
        "  userName: RootUserName;",
        "  v2: RootV2;",
        '  "2fa": Root2fa;',
        '  "é": Root2;',
        "}",
        "",
        "export interface RootAB {",
        "  first: boolean;",
        "}",
        "",
        "export interface RootAB2 {",
        "  second: boolean;",
        "}",
        "",
        "export interface RootUserName {",
        "  third: boolean;",
        "}",
        "",
        "export interface RootV2 {",
        "  fourth: boolean;",
        "}",
        "",
        "export interface Root2fa {",
        "  fifth: boolean;",
        "}",
        "",
        "export interface Root2 {",
        "  sixth: boolean;",
        "}",
      ].join("\n"),
    );
  });

  test("quotes non-identifier keys and treats prototype-named keys as ordinary", () => {
    const value = JSON.parse(
      '{"__proto__":1,"constructor":null,"a-b":true,"has space":"x"}',
    ) as Record<string, unknown>;
    expect(generateTypeScript([value])).toBe(
      [
        "export interface Root {",
        "  __proto__: number;",
        "  constructor: null;",
        '  "a-b": boolean;',
        '  "has space": string;',
        "}",
      ].join("\n"),
    );
  });

  test("renders empty object roots as empty declarations", () => {
    expect(generateTypeScript([{}, {}])).toBe("export interface Root {}");
    expect(generateTypeScript([{}], { type: true })).toBe("export type Root = {};");
  });

  test("requires at least one document", () => {
    expect(() => generateTypeScript([])).toThrow("at least one document is required");
  });
});
