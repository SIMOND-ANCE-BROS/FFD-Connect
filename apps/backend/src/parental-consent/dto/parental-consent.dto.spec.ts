import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  ConfirmParentalConsentDto,
  ParentalConsentTokenDto,
  RequestParentalConsentDto,
} from "./parental-consent.dto";

async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((error) => error.property);
}

// 64 hex characters, the shape of a consent token (not a secret).
const TOKEN = "a".repeat(64);

describe("parental consent DTOs (#61)", () => {
  it("normalises a valid parent address", async () => {
    const dto = plainToInstance(RequestParentalConsentDto, {
      parentEmail: "  Parent@Example.com ",
    });
    expect(dto.parentEmail).toBe("parent@example.com");
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([undefined, "", "not-an-email", "pàrent@example.com"])(
    "refuses the parent address %p",
    async (parentEmail) => {
      expect(
        await errorsOf(RequestParentalConsentDto, { parentEmail }),
      ).toContain("parentEmail");
    },
  );

  it("accepts a 64-hex token only", async () => {
    expect(await errorsOf(ParentalConsentTokenDto, { token: TOKEN })).toEqual(
      [],
    );
    for (const token of [undefined, "abc", `${TOKEN}0`, "z".repeat(64)]) {
      expect(await errorsOf(ParentalConsentTokenDto, { token })).toContain(
        "token",
      );
    }
  });

  it("requires both explicit agreements to confirm", async () => {
    expect(
      await errorsOf(ConfirmParentalConsentDto, {
        token: TOKEN,
        acceptDataProcessing: true,
        acceptHealthData: true,
      }),
    ).toEqual([]);
    expect(
      await errorsOf(ConfirmParentalConsentDto, {
        token: TOKEN,
        acceptDataProcessing: true,
        acceptHealthData: false,
      }),
    ).toEqual(["acceptHealthData"]);
    expect(
      await errorsOf(ConfirmParentalConsentDto, {
        token: TOKEN,
        acceptDataProcessing: "true",
        acceptHealthData: true,
      }),
    ).toEqual(["acceptDataProcessing"]);
  });
});
