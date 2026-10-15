import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  buildEntryQr,
  ENTRY_QR_NAME_MAX_LENGTH,
} from "../../licenses/qr/entry-qr";
import { CHECK_IN_QR_DATA_MAX_LENGTH, CheckInDto } from "./checkin.dto";
import { VolunteerCheckInDto } from "./volunteer-token.dto";

describe("check-in DTOs — qrData length (#168)", () => {
  const ok = "x".repeat(CHECK_IN_QR_DATA_MAX_LENGTH);
  const tooLong = "x".repeat(CHECK_IN_QR_DATA_MAX_LENGTH + 1);

  it("caps CheckInDto.qrData at 512 characters", async () => {
    expect(CHECK_IN_QR_DATA_MAX_LENGTH).toBe(512);
    expect(
      await validate(plainToInstance(CheckInDto, { qrData: ok })),
    ).toHaveLength(0);
    const errors = await validate(
      plainToInstance(CheckInDto, { qrData: tooLong }),
    );
    expect(errors[0]?.constraints).toHaveProperty("maxLength");
  });

  it("caps VolunteerCheckInDto.qrData at 512 characters", async () => {
    const base = { competitionId: "c1", token: "t" };
    expect(
      await validate(
        plainToInstance(VolunteerCheckInDto, { ...base, qrData: ok }),
      ),
    ).toHaveLength(0);
    const errors = await validate(
      plainToInstance(VolunteerCheckInDto, { ...base, qrData: tooLong }),
    );
    expect(errors[0]?.constraints).toHaveProperty("maxLength");
  });

  it("fits the largest rotating entry QR (v3, #24)", () => {
    const largest = buildEntryQr(
      "AbCdEfGhIjK",
      {
        licenseId: "l".repeat(64),
        number: "n".repeat(64),
        holderName: "h".repeat(ENTRY_QR_NAME_MAX_LENGTH),
      },
      Number.MAX_SAFE_INTEGER,
      "s".repeat(86),
    );
    expect(largest.length).toBeLessThanOrEqual(CHECK_IN_QR_DATA_MAX_LENGTH);
  });
});

describe("check-in DTOs — scannedAt of an offline scan (#24)", () => {
  it.each([CheckInDto, VolunteerCheckInDto])(
    "%p accepts an ISO 8601 instant or nothing",
    async (dto) => {
      const base = { competitionId: "c1", token: "t", qrData: "qr" };
      expect(await validate(plainToInstance(dto, base))).toHaveLength(0);
      expect(
        await validate(
          plainToInstance(dto, {
            ...base,
            scannedAt: "2026-10-16T09:12:30.000Z",
          }),
        ),
      ).toHaveLength(0);
    },
  );

  it.each([CheckInDto, VolunteerCheckInDto])(
    "%p refuses anything else",
    async (dto) => {
      const base = { competitionId: "c1", token: "t", qrData: "qr" };
      for (const scannedAt of ["yesterday", "2026-13-45T00:00:00Z", 12]) {
        const errors = await validate(
          plainToInstance(dto, { ...base, scannedAt }),
        );
        expect(errors[0]?.constraints).toHaveProperty("isIso8601");
      }
    },
  );
});
