/**
 * Local images of a deleted account (#936): the licence photo and club logo
 * picked from the gallery, copied by the image picker into the app's cache.
 */
import { deleteAsync } from "expo-file-system/legacy";
import { deleteAccountImages } from "../accountImages";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///app/Documents/",
  cacheDirectory: "file:///app/Caches/",
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const del = deleteAsync as jest.Mock;
const deleted = () => del.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deleteAccountImages", () => {
  it("deletes the given app files and the image picker copies", async () => {
    await deleteAccountImages([
      "file:///app/Caches/ImagePicker/photo.jpg",
      "file:///app/Documents/logo.png",
    ]);

    expect(deleted()).toEqual([
      "file:///app/Caches/ImagePicker/photo.jpg",
      "file:///app/Documents/logo.png",
      // Every earlier pick too: each selection left its own copy.
      "file:///app/Caches/ImagePicker/",
    ]);
    for (const call of del.mock.calls) {
      expect(call[1]).toEqual({ idempotent: true });
    }
  });

  it("never touches a file outside the app's own folders", async () => {
    await deleteAccountImages([
      "file:///var/mobile/Media/DCIM/photo.jpg",
      "https://cdn.example/logo.png",
      "file:///app/Caches/../../etc/hosts",
      undefined,
      "",
    ]);

    expect(deleted()).toEqual(["file:///app/Caches/ImagePicker/"]);
  });

  it("keeps going when a deletion fails", async () => {
    del.mockRejectedValueOnce(new Error("busy"));

    await expect(
      deleteAccountImages(["file:///app/Documents/a.jpg"]),
    ).resolves.toBeUndefined();

    expect(deleted()).toContain("file:///app/Caches/ImagePicker/");
  });
});
