import { getDocumentProxy } from "unpdf";
import {
  extractPdfText,
  isPdf,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_LENGTH,
} from "./pdf-text.util";

// unpdf loads its pdf.js bundle with a dynamic ESM import, which Jest's CJS
// runtime cannot execute: the library is mocked here. Real extraction was
// exercised outside Jest (plain Node, real FFD circulars).
jest.mock("unpdf", () => ({ getDocumentProxy: jest.fn() }));

const mockedGetDocumentProxy = getDocumentProxy as jest.MockedFunction<
  typeof getDocumentProxy
>;

type Item = { str?: string; hasEOL?: boolean };

function fakePdf(pages: Item[][]) {
  const destroy = jest.fn().mockResolvedValue(undefined);
  const getPage = jest.fn((pageNumber: number) =>
    Promise.resolve({
      getTextContent: () => Promise.resolve({ items: pages[pageNumber - 1] }),
    }),
  );
  const pdf = {
    numPages: pages.length,
    getPage,
    loadingTask: { destroy },
  } as unknown as Awaited<ReturnType<typeof getDocumentProxy>>;
  mockedGetDocumentProxy.mockResolvedValue(pdf);
  return { destroy, getPage };
}

describe("isPdf", () => {
  it("recognises the %PDF magic bytes", () => {
    expect(isPdf(Buffer.from("%PDF-1.7\n"))).toBe(true);
    expect(isPdf(Buffer.from("<html>"))).toBe(false);
    expect(isPdf(Buffer.from("%P"))).toBe(false);
  });
});

describe("extractPdfText", () => {
  beforeEach(() => jest.clearAllMocks());

  it("joins text items, keeps line breaks and releases the document", async () => {
    const { destroy } = fakePdf([
      [
        { str: "Juniors 1", hasEOL: false },
        { str: " Latines", hasEOL: true },
      ],
      [{ str: "Youth" }, {}],
    ]);
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await expect(extractPdfText(data)).resolves.toBe(
      "Juniors 1 Latines\n\nYouth\n",
    );
    expect(mockedGetDocumentProxy).toHaveBeenCalledWith(data, {
      verbosity: 0,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it(`reads at most ${MAX_PDF_PAGES} pages`, async () => {
    const { getPage } = fakePdf(
      Array.from({ length: MAX_PDF_PAGES + 30 }, () => [{ str: "x" }]),
    );

    await extractPdfText(new Uint8Array([1]));

    expect(getPage).toHaveBeenCalledTimes(MAX_PDF_PAGES);
  });

  it(`stops at ${MAX_PDF_TEXT_LENGTH} characters`, async () => {
    const { getPage } = fakePdf(
      Array.from({ length: 5 }, () => [
        { str: "a".repeat(MAX_PDF_TEXT_LENGTH) },
      ]),
    );

    const text = await extractPdfText(new Uint8Array([1]));

    expect(text).toHaveLength(MAX_PDF_TEXT_LENGTH);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it("releases the document when extraction fails", async () => {
    const { destroy, getPage } = fakePdf([[{ str: "x" }]]);
    getPage.mockRejectedValueOnce(new Error("bad xref"));

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toThrow(
      "bad xref",
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
