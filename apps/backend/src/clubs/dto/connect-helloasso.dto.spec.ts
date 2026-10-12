import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ConnectHelloAssoDto } from "./connect-helloasso.dto";

const errorsFor = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(ConnectHelloAssoDto, body)).map(
    (e) => e.property,
  );

describe("ConnectHelloAssoDto", () => {
  const valid = {
    clientId: "id",
    clientSecret: "secret",
    organizationSlug: "mon-club",
  };

  it("accepts valid credentials", () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it("rejects an empty client secret", () => {
    expect(errorsFor({ ...valid, clientSecret: "" })).toContain("clientSecret");
  });

  it("caps the client secret at 255 characters (#389)", () => {
    expect(errorsFor({ ...valid, clientSecret: "x".repeat(255) })).toEqual([]);
    expect(errorsFor({ ...valid, clientSecret: "x".repeat(256) })).toContain(
      "clientSecret",
    );
  });

  it("accepts a real HelloAsso slug (#404)", () => {
    expect(
      errorsFor({ ...valid, organizationSlug: "simond-ance-bros-sdb" }),
    ).toEqual([]);
  });

  it("normalises case and spaces of a typed slug", () => {
    const dto = plainToInstance(ConnectHelloAssoDto, {
      ...valid,
      organizationSlug: "  Mon-Club ",
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.organizationSlug).toBe("mon-club");
  });

  it.each(["..", "a/b", "club slug", "x".repeat(256)])(
    "rejects the slug %p, which could alter the API path (#404)",
    (organizationSlug) => {
      expect(errorsFor({ ...valid, organizationSlug })).toContain(
        "organizationSlug",
      );
    },
  );
});
