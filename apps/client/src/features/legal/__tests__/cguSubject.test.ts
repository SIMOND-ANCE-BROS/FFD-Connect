/** Qui accepte les CGU dans la session en cours (#894). */
import { AuthService } from "../../auth/services/AuthService";
import { currentCguSubject } from "../cguSubject";

jest.mock("../../auth/services/AuthService", () => ({
  AuthService: { getAuthConfig: jest.fn() },
}));

const getAuthConfig = AuthService.getAuthConfig as jest.Mock;

describe("currentCguSubject", () => {
  it.each([
    ["signed out", { isLoggedIn: false, userId: "u1" }],
    [
      "a support session",
      { isLoggedIn: true, impersonating: true, username: "x@y.fr" },
    ],
    ["an account without any identifier", { isLoggedIn: true }],
  ])("nobody to ask when %s", async (_label, config) => {
    getAuthConfig.mockResolvedValue(config);
    await expect(currentCguSubject()).resolves.toBeNull();
  });

  it("a guest accepts for the device", async () => {
    getAuthConfig.mockResolvedValue({ isLoggedIn: true, isGuest: true });
    await expect(currentCguSubject()).resolves.toEqual({ kind: "guest" });
  });

  it("an account is identified by its id", async () => {
    getAuthConfig.mockResolvedValue({
      isLoggedIn: true,
      userId: "u1",
      username: "lea@example.fr",
    });
    await expect(currentCguSubject()).resolves.toEqual({
      kind: "account",
      id: "u1",
    });
  });

  it("falls back to the e-mail for a session opened without the id", async () => {
    getAuthConfig.mockResolvedValue({
      isLoggedIn: true,
      username: "lea@example.fr",
    });
    await expect(currentCguSubject()).resolves.toEqual({
      kind: "account",
      id: "lea@example.fr",
    });
  });
});
