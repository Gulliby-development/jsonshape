export interface RenderOptions {
  name?: string;
  readonly?: boolean;
  type?: boolean;
  indent?: string;
}

type Kind = "string" | "number" | "boolean" | "null" | "object" | "array";

interface Shape {
  kinds: Set<Kind>;
  occurrences: number;
  properties: Map<string, { shape: Shape; present: number }>;
  element?: Shape;
}

const makeShape = (): Shape => ({
  kinds: new Set<Kind>(),
  occurrences: 0,
  properties: new Map(),
});

function addValue(shape: Shape, value: unknown): void {
  if (value === null) {
    shape.kinds.add("null");
    return;
  }
  if (Array.isArray(value)) {
    shape.kinds.add("array");
    shape.element ??= makeShape();
    for (const item of value) addValue(shape.element, item);
    return;
  }
  if (typeof value === "object") {
    shape.kinds.add("object");
    shape.occurrences += 1;
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      let property = shape.properties.get(key);
      if (!property) {
        property = { shape: makeShape(), present: 0 };
        shape.properties.set(key, property);
      }
      property.present += 1;
      addValue(property.shape, record[key]);
    }
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    shape.kinds.add(typeof value as "string" | "number" | "boolean");
  }
}

function pascalWords(value: string): string {
  const words = value.match(/[A-Za-z0-9]+/g) ?? [];
  return words
    .map((word) => {
      const parts = word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
      return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
    })
    .join("");
}

function propertyName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderType(shape: Shape, names: Map<Shape, string>, options: RenderOptions): string {
  const order: Kind[] = ["string", "number", "boolean", "null", "object", "array"];
  const members: string[] = [];
  for (const kind of order) {
    if (!shape.kinds.has(kind)) continue;
    if (kind === "object") members.push(names.get(shape) ?? "Record<string, unknown>");
    else if (kind === "array") {
      const element = shape.element?.kinds.size
        ? renderType(shape.element, names, options)
        : "unknown";
      const wrapped =
        (shape.element?.kinds.size ?? 0) > 1 ||
        (options.readonly && shape.element?.kinds.has("array"))
          ? `(${element})`
          : element;
      members.push(options.readonly ? `readonly ${wrapped}[]` : `${wrapped}[]`);
    } else members.push(kind);
  }
  return members.join(" | ") || "unknown";
}

function collectDeclarations(
  root: Shape,
  rootName: string,
): {
  names: Map<Shape, string>;
  declarations: Shape[];
} {
  const names = new Map<Shape, string>();
  const declarations: Shape[] = [];
  const used = new Set<string>();
  const assign = (shape: Shape, proposed: string): void => {
    if (!shape.kinds.has("object") || names.has(shape)) return;
    let name = proposed;
    let suffix = 2;
    while (used.has(name)) name = `${proposed}${suffix++}`;
    used.add(name);
    names.set(shape, name);
    declarations.push(shape);
  };
  const walk = (shape: Shape, name: string, throughArray: boolean, isRoot: boolean): void => {
    if (shape.kinds.has("object")) {
      const objectName = isRoot ? rootName : `${name}${throughArray ? "Item" : ""}`;
      assign(shape, objectName);
      for (const [key, property] of shape.properties) {
        walk(property.shape, `${names.get(shape)}${pascalWords(key)}`, false, false);
      }
    }
    if (shape.kinds.has("array") && shape.element) {
      walk(shape.element, name, true, false);
    }
  };
  walk(root, rootName, false, root.kinds.has("object"));
  return { names, declarations };
}

function renderObject(shape: Shape, names: Map<Shape, string>, options: RenderOptions): string {
  const name = names.get(shape) ?? "Root";
  const lines = [...shape.properties].map(([key, property]) => {
    const optional = property.present < shape.occurrences ? "?" : "";
    const readonly = options.readonly ? "readonly " : "";
    return `${options.indent ?? "  "}${readonly}${propertyName(key)}${optional}: ${renderType(property.shape, names, options)};`;
  });
  if (options.type)
    return `export type ${name} = {${lines.length ? `\n${lines.join("\n")}\n` : ""}};`;
  return `export interface ${name} {${lines.length ? `\n${lines.join("\n")}\n` : ""}}`;
}

/** Merge parsed JSON documents and render deterministic TypeScript declarations. */
export function generateTypeScript(documents: unknown[], options: RenderOptions = {}): string {
  if (documents.length === 0) throw new Error("at least one document is required");
  const root = makeShape();
  for (const document of documents) addValue(root, document);
  if (root.kinds.has("object") && root.kinds.size > 1) {
    throw new Error("documents mix object and non-object roots");
  }

  const rootName = options.name ?? "Root";
  const { names, declarations } = collectDeclarations(root, rootName);
  const output = declarations.map((shape) => renderObject(shape, names, options));
  if (!root.kinds.has("object")) {
    output.push(`export type ${rootName} = ${renderType(root, names, options)};`);
  }
  return output.join("\n\n");
}

export const jsonshape = generateTypeScript;
