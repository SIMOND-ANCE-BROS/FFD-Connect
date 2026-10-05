import * as fs from "fs";
import * as os from "os";
import {
  readContainerMemoryLimit,
  resolveMemoryLimit,
  toPercent,
} from "./container-memory.util";

// Node >= 22 exports `fs.readFileSync` and `os.totalmem` as non-configurable
// properties, so they cannot be spied on in place — the modules are replaced.
jest.mock("fs", () => ({
  ...jest.requireActual<typeof import("fs")>("fs"),
  readFileSync: jest.fn(),
}));
jest.mock("os", () => ({
  ...jest.requireActual<typeof import("os")>("os"),
  totalmem: jest.fn(),
}));

const CGROUP_V2 = "/sys/fs/cgroup/memory.max";
const CGROUP_V1 = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
const HOST_RAM = 16 * 1024 ** 3;

describe("container-memory.util", () => {
  beforeEach(() => {
    jest.mocked(os.totalmem).mockReturnValue(HOST_RAM);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  /** Makes only the listed cgroup files readable; every other path throws. */
  function withCgroupFiles(files: Record<string, string | undefined>): void {
    jest.mocked(fs.readFileSync).mockImplementation((file) => {
      const content = files[String(file)];
      if (content === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return content;
    });
  }

  describe("readContainerMemoryLimit", () => {
    it("reads the cgroup v2 limit (Azure Container Apps)", () => {
      withCgroupFiles({ [CGROUP_V2]: "1073741824\n" });
      expect(readContainerMemoryLimit()).toBe(1073741824);
    });

    it("falls back to cgroup v1 when v2 is absent", () => {
      withCgroupFiles({ [CGROUP_V1]: "536870912\n" });
      expect(readContainerMemoryLimit()).toBe(536870912);
    });

    it("returns null when no cgroup file exists (macOS dev machine)", () => {
      withCgroupFiles({});
      expect(readContainerMemoryLimit()).toBeNull();
    });

    it("returns null when cgroup v2 reports no cap", () => {
      withCgroupFiles({ [CGROUP_V2]: "max\n" });
      expect(readContainerMemoryLimit()).toBeNull();
    });

    it("returns null for the cgroup v1 unlimited sentinel", () => {
      withCgroupFiles({ [CGROUP_V1]: "9223372036854771712\n" });
      expect(readContainerMemoryLimit()).toBeNull();
    });

    it("skips unparsable contents instead of reporting NaN", () => {
      withCgroupFiles({
        [CGROUP_V2]: "not-a-number",
        [CGROUP_V1]: "262144000",
      });
      expect(readContainerMemoryLimit()).toBe(262144000);
    });
  });

  describe("resolveMemoryLimit", () => {
    it("reports the container limit with source cgroup", () => {
      withCgroupFiles({ [CGROUP_V2]: "1073741824" });
      expect(resolveMemoryLimit()).toEqual({
        bytes: 1073741824,
        source: "cgroup",
      });
    });

    it("degrades to the host RAM with source os when uncapped", () => {
      withCgroupFiles({});
      expect(resolveMemoryLimit()).toEqual({ bytes: HOST_RAM, source: "os" });
    });
  });

  describe("toPercent", () => {
    it("keeps one decimal so a small share is not rounded to zero", () => {
      expect(toPercent(80 * 1024 ** 2, 64 * 1024 ** 3)).toBe(0.1);
    });

    it("reports the container ratio from the issue (~79 MB of 1 Gi)", () => {
      expect(toPercent(82_837_504, 1_073_741_824)).toBe(7.7);
    });

    it("returns 0 rather than NaN or Infinity on a zero total", () => {
      expect(toPercent(100, 0)).toBe(0);
    });
  });
});
