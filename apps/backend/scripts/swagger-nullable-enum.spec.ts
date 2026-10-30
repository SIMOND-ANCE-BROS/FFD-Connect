import * as fs from "fs";
import * as path from "path";

/**
 * Contract of the committed swagger.json (kept fresh by the backend-build CI
 * job). OpenAPI 3.0 generators (hey-api, apps/admin and apps/client) ignore
 * `nullable: true` on an enum unless `null` is one of its values: the
 * generated type then rejects the `null` the API returns (#290). Declare such
 * a property with `enum: [...VALUES, null]`.
 */

type SchemaNode = Record<string, unknown>;

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null;

/** JSON paths of every `nullable` enum whose values lack `null`. */
export function findNullableEnumsWithoutNull(
  node: unknown,
  at = "$",
): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) =>
      findNullableEnumsWithoutNull(item, `${at}[${i}]`),
    );
  }
  if (!isNode(node)) return [];
  const own =
    node.nullable === true &&
    Array.isArray(node.enum) &&
    !node.enum.includes(null)
      ? [at]
      : [];
  return [
    ...own,
    ...Object.entries(node).flatMap(([key, child]) =>
      findNullableEnumsWithoutNull(child, `${at}.${key}`),
    ),
  ];
}

describe("swagger.json nullable enums (#290)", () => {
  it("flags a nullable enum without null, and only that", () => {
    expect(
      findNullableEnumsWithoutNull({
        properties: {
          bad: { type: "string", nullable: true, enum: ["A", "B"] },
          good: { type: "string", nullable: true, enum: ["A", null] },
          plain: { type: "string", enum: ["A"] },
          text: { type: "string", nullable: true },
          list: [{ nullable: true, enum: ["X"] }],
        },
      }),
    ).toEqual(["$.properties.bad", "$.properties.list[0]"]);
  });

  it("every nullable enum of the committed spec accepts null", () => {
    const spec: unknown = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../swagger.json"), "utf8"),
    );

    expect(findNullableEnumsWithoutNull(spec)).toEqual([]);
  });
});
