import { extractText, getDocumentProxy } from "unpdf";
import { extractPdfText, isPdf } from "./pdf-text.util";

// unpdf loads its pdf.js bundle with a dynamic ESM import, which Jest's CJS
// runtime cannot execute: the library is mocked here. Real extraction is
// exercised outside Jest (plain Node), see the PR description.
jest.mock("unpdf", () => ({
  getDocumentProxy: jest.fn(),
  extractText: jest.fn(),
}));

const mockedGetDocumentProxy = getDocumentProxy as jest.MockedFunction<
  typeof getDocumentProxy
>;
const mockedExtractText = extractText as jest.MockedFunction<
  typeof extractText
>;

describe("isPdf", () => {
  it("recognises the %PDF magic bytes", () => {
    expect(isPdf(Buffer.from("%PDF-1.7\n"))).toBe(true);
    expect(isPdf(Buffer.from("<html>"))).toBe(false);
    expect(isPdf(Buffer.from("%P"))).toBe(false);
  });
});

describe("extractPdfText", () => {
  const destroy = jest.fn().mockResolvedValue(undefined);
  const pdf = { loadingTask: { destroy } } as unknown as Awaited<
    ReturnType<typeof getDocumentProxy>
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDocumentProxy.mockResolvedValue(pdf);
  });

  it("returns the merged text layer and releases the document", async () => {
    mockedExtractText.mockResolvedValue({
      totalPages: 2,
      text: "Juniors 1 Latines",
    });
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await expect(extractPdfText(data)).resolves.toBe("Juniors 1 Latines");
    expect(mockedGetDocumentProxy).toHaveBeenCalledWith(data, {
      verbosity: 0,
    });
    expect(mockedExtractText).toHaveBeenCalledWith(pdf, { mergePages: true });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("releases the document when extraction fails", async () => {
    mockedExtractText.mockRejectedValue(new Error("bad xref"));

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toThrow(
      "bad xref",
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
