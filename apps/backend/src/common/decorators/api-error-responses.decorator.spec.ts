import { ApiCommonErrorResponses } from "./api-error-responses.decorator";

describe("ApiCommonErrorResponses", () => {
  it("should return a function that applies decorators", () => {
    const result = ApiCommonErrorResponses();
    expect(result).toBeDefined();
    expect(typeof result).toBe("function");
  });

  it("should be callable without errors", () => {
    expect(() => ApiCommonErrorResponses()).not.toThrow();
  });
});
