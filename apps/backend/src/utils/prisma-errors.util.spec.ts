import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { handlePrismaError } from "./prisma-errors.util";

function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("test", {
    code,
    clientVersion: "0",
  });
}

describe("handlePrismaError", () => {
  it("throws ConflictException on P2002 (unique constraint)", () => {
    expect(() => handlePrismaError(makePrismaError("P2002"), "User")).toThrow(
      ConflictException,
    );
  });

  it("throws NotFoundException on P2025 (record not found)", () => {
    expect(() => handlePrismaError(makePrismaError("P2025"), "User")).toThrow(
      NotFoundException,
    );
  });

  it("throws ConflictException on P2003 (foreign key constraint)", () => {
    expect(() => handlePrismaError(makePrismaError("P2003"), "User")).toThrow(
      ConflictException,
    );
  });

  it("re-throws non-Prisma errors as-is", () => {
    const raw = new Error("unexpected");
    expect(() => handlePrismaError(raw)).toThrow(raw);
  });

  it("re-throws unknown Prisma error codes as-is", () => {
    const err = makePrismaError("P9999");
    expect(() => handlePrismaError(err)).toThrow(err);
  });
});
