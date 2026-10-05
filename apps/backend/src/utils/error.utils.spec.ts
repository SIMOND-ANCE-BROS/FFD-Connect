import {
  getErrorCode,
  getErrorMessage,
  getErrorStack,
  isError,
} from "./error.utils";

describe("error.utils", () => {
  describe("getErrorMessage", () => {
    it("should extract message from Error instance", () => {
      const error = new Error("Test error message");
      expect(getErrorMessage(error)).toBe("Test error message");
    });

    it("should return string as-is", () => {
      const error = "String error";
      expect(getErrorMessage(error)).toBe("String error");
    });

    it("should extract message from object with message property", () => {
      const error = { message: "Object error message" };
      expect(getErrorMessage(error)).toBe("Object error message");
    });

    it('should return "Unknown error" for unknown types', () => {
      const error = { code: 500 };
      expect(getErrorMessage(error)).toBe("Unknown error");
    });

    it("should handle null", () => {
      expect(getErrorMessage(null)).toBe("Unknown error");
    });

    it("should handle undefined", () => {
      expect(getErrorMessage(undefined)).toBe("Unknown error");
    });
  });

  describe("getErrorStack", () => {
    it("should extract stack from Error instance", () => {
      const error = new Error("Test error");
      const stack = getErrorStack(error);
      expect(stack).toBeDefined();
      expect(typeof stack).toBe("string");
      expect(stack).toContain("Error: Test error");
    });

    it("should return undefined for non-Error types", () => {
      expect(getErrorStack("string error")).toBeUndefined();
      expect(getErrorStack({ message: "error" })).toBeUndefined();
      expect(getErrorStack(null)).toBeUndefined();
    });
  });

  describe("isError", () => {
    it("should return true for Error instances", () => {
      expect(isError(new Error("test"))).toBe(true);
      expect(isError(new TypeError("test"))).toBe(true);
    });

    it("should return false for non-Error types", () => {
      expect(isError("string")).toBe(false);
      expect(isError({ message: "error" })).toBe(false);
      expect(isError(null)).toBe(false);
      expect(isError(undefined)).toBe(false);
      expect(isError(123)).toBe(false);
    });
  });

  describe("getErrorCode", () => {
    it("extrait le code string d'une erreur SDK (ex. firebase-admin)", () => {
      const error = Object.assign(new Error("boom"), {
        code: "messaging/registration-token-not-registered",
      });
      expect(getErrorCode(error)).toBe(
        "messaging/registration-token-not-registered",
      );
    });

    it("lit aussi un objet nu porteur d'un code", () => {
      expect(getErrorCode({ code: "P2002" })).toBe("P2002");
    });

    it("retourne undefined quand le code est absent ou non-string", () => {
      expect(getErrorCode(new Error("no code"))).toBeUndefined();
      expect(getErrorCode({ code: 500 })).toBeUndefined();
      expect(getErrorCode("string error")).toBeUndefined();
      expect(getErrorCode(null)).toBeUndefined();
      expect(getErrorCode(undefined)).toBeUndefined();
    });
  });
});
