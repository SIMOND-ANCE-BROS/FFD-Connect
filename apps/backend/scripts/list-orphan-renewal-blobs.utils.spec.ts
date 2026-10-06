import {
  findOrphanRenewalBlobs,
  isRenewalDocumentBlobName,
} from "./list-orphan-renewal-blobs.utils";

describe("isRenewalDocumentBlobName", () => {
  it.each([
    "document-1712345678901-123456789.jpg",
    "document-1712345678901-123456789.pdf",
    "document-1712345678901-0.PNG",
    "document-1712345678901-123456789",
  ])("matches renewal document blob %s", (name) => {
    expect(isRenewalDocumentBlobName(name)).toBe(true);
  });

  it.each([
    "track-1712345678901-123456789.mp3",
    "cover-1712345678901-123456789.jpg",
    "my-document-1712345678901-1.jpg",
    "document-abc-1.jpg",
    "documents-1712345678901-1.jpg",
    "document-1712345678901-1.jpg.mp3.bak/evil",
    "renewal/document-1712345678901-1.jpg",
    "Cha Cha 120 BPM.mp3",
    "",
  ])("does not match %s", (name) => {
    expect(isRenewalDocumentBlobName(name)).toBe(false);
  });
});

describe("findOrphanRenewalBlobs", () => {
  const d = new Date("2026-01-01T00:00:00Z");

  it("lists only unreferenced renewal blobs, sorted by name", () => {
    const result = findOrphanRenewalBlobs(
      [
        { name: "document-2-2.jpg", lastModified: d },
        { name: "document-1-1.jpg", lastModified: d },
        { name: "document-3-3.pdf", lastModified: d },
        { name: "track-9-9.mp3", lastModified: d },
      ],
      ["document-3-3.pdf"],
    );
    expect(result.map((b) => b.name)).toEqual([
      "document-1-1.jpg",
      "document-2-2.jpg",
    ]);
  });

  it("treats a legacy disk path reference as referencing its basename", () => {
    const result = findOrphanRenewalBlobs(
      [{ name: "document-1-1.jpg" }],
      ["uploads/renewal/document-1-1.jpg"],
    );
    expect(result).toEqual([]);
  });

  it("returns nothing when there are no blobs", () => {
    expect(findOrphanRenewalBlobs([], ["document-1-1.jpg"])).toEqual([]);
  });
});
