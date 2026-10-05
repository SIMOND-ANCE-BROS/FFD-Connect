// apps/backend/src/utils/require-production-env.spec.ts
import { requireProductionEnv } from "./require-production-env";

describe("requireProductionEnv", () => {
  const makeCallbacks = () => ({
    onError: jest.fn(),
    onWarn: jest.fn(),
    exit: jest.fn() as unknown as (code: number) => never,
  });

  it("calls exit(1) when value is missing in production", () => {
    const cb = makeCallbacks();
    requireProductionEnv("MY_KEY", undefined, "production", cb);
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining("MY_KEY"));
    expect(cb.exit).toHaveBeenCalledWith(1);
    expect(cb.onWarn).not.toHaveBeenCalled();
  });

  it("calls onWarn when value is missing outside production", () => {
    const cb = makeCallbacks();
    requireProductionEnv("MY_KEY", undefined, "development", cb);
    expect(cb.onWarn).toHaveBeenCalledWith(expect.stringContaining("MY_KEY"));
    expect(cb.exit).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it("does nothing when value is present", () => {
    const cb = makeCallbacks();
    requireProductionEnv("MY_KEY", "some-value", "production", cb);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onWarn).not.toHaveBeenCalled();
    expect(cb.exit).not.toHaveBeenCalled();
  });

  it("calls onWarn when value is missing and nodeEnv is undefined", () => {
    const cb = makeCallbacks();
    requireProductionEnv("MY_KEY", undefined, undefined, cb);
    expect(cb.onWarn).toHaveBeenCalled();
    expect(cb.exit).not.toHaveBeenCalled();
  });
});
