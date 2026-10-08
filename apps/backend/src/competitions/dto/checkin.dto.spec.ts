import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
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
});
