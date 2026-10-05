import { createUploadStorage } from "./upload-storage.util";

interface DiskStorageEngine {
  getFilename: (
    req: unknown,
    file: { fieldname: string; originalname: string },
    cb: (error: Error | null, filename: string) => void,
  ) => void;
  getDestination: (
    req: unknown,
    file: unknown,
    cb: (error: Error | null, destination: string) => void,
  ) => void;
}

describe("createUploadStorage", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("returns a memory storage in test env (no disk I/O)", () => {
    process.env.NODE_ENV = "test";
    const storage = createUploadStorage("./uploads/certificates");
    // memoryStorage n'expose pas getFilename/getDestination, contrairement à diskStorage
    expect((storage as Partial<DiskStorageEngine>).getFilename).toBeUndefined();
  });

  it("returns a disk storage outside test env", () => {
    process.env.NODE_ENV = "development";
    const storage = createUploadStorage(
      "./uploads/certificates",
    ) as unknown as DiskStorageEngine;
    expect(typeof storage.getFilename).toBe("function");
  });

  it("generates a unique filename keeping fieldname and extension", () => {
    process.env.NODE_ENV = "development";
    const storage = createUploadStorage(
      "./uploads/certificates",
    ) as unknown as DiskStorageEngine;

    const file = { fieldname: "certificate", originalname: "scan.pdf" };
    let generated = "";
    storage.getFilename(undefined, file, (error, filename) => {
      expect(error).toBeNull();
      generated = filename;
    });

    expect(generated).toMatch(/^certificate-\d+-\d+\.pdf$/);
  });
});
