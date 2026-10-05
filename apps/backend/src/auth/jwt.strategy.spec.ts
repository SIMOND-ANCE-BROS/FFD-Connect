import { ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  it("should map payload to user object", () => {
    const configService = {
      getOrThrow: jest
        .fn()
        .mockReturnValue("test-secret-32-chars-minimum!!!!!"),
    } as unknown as ConfigService;

    const strategy = new JwtStrategy(configService);
    const payload = {
      sub: "user-1",
      email: "test@example.com",
      role: "LICENSEE",
    };

    expect(strategy.validate(payload)).toEqual({
      userId: "user-1",
      email: "test@example.com",
      role: "LICENSEE",
    });
  });
});
