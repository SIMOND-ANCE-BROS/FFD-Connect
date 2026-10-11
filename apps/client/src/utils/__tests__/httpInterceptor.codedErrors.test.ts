import { httpErrorFromBody, httpPost, HttpError } from "../httpInterceptor";

const mockError = jest.fn();
jest.mock("../logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

// A medical refusal as the server answers it (#225): health data in `message`.
const MEDICAL_TEXT =
  "Le certificat médical indique que vous n'êtes pas apte (SENTINEL-225)";
const CODED_BODY = {
  statusCode: 400,
  message: MEDICAL_TEXT,
  code: "MEDICAL_UNFIT",
};

function respondWith(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Bad Request",
    headers: new Headers(),
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn(),
  });
}

describe("httpErrorFromBody (#225)", () => {
  it("keeps a coded refusal's text out of everything a log can read", () => {
    const err = httpErrorFromBody(400, "Bad Request", CODED_BODY, "Échec");

    expect(err.message).toBe("Échec");
    expect(err.data).toBeNull();
    expect(err.code).toBe("MEDICAL_UNFIT");
    expect(err.userMessage).toBe(MEDICAL_TEXT);
    // Non-enumerable: no serialization of the error carries them.
    expect(Object.keys(err)).not.toContain("userMessage");
    expect(Object.keys(err)).not.toContain("code");
    expect(JSON.stringify(err)).not.toContain("SENTINEL-225");
    expect(JSON.stringify(err)).not.toContain("MEDICAL_UNFIT");
    expect(err.stack).not.toContain("SENTINEL-225");
  });

  it("keeps the historical behaviour for an uncoded body", () => {
    const body = { message: "Club introuvable" };
    const err = httpErrorFromBody(404, "Not Found", body, "Échec");
    expect(err.message).toBe("Club introuvable");
    expect(err.data).toEqual(body);
    expect(err.code).toBeUndefined();
    expect(err.userMessage).toBeUndefined();
  });

  it.each([null, "plain text", { code: "" }, { message: 3 }])(
    "falls back on the generic message for %p",
    (body) => {
      expect(httpErrorFromBody(500, "Error", body, "Échec").message).toBe(
        "Échec",
      );
    },
  );
});

describe("httpRequest — error logging (#225)", () => {
  beforeEach(() => mockError.mockClear());

  it("never sends the error body, its text or its code to the logger", async () => {
    respondWith(400, CODED_BODY);

    const err = await httpPost(
      "/api/licenses/renewal/r1/submit",
      {},
      { errorMessage: "L'opération a échoué", logErrors: true },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).message).toBe("L'opération a échoué");
    expect((err as HttpError).userMessage).toBe(MEDICAL_TEXT);
    expect(mockError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mockError.mock.calls);
    expect(logged).toContain("400");
    expect(logged).not.toContain("SENTINEL-225");
    expect(logged).not.toContain("MEDICAL_UNFIT");
  });

  it("does not send an uncoded body either", async () => {
    respondWith(400, { message: "Détail serveur (SENTINEL-BODY)" });

    await httpPost("/api/x", {}).catch(() => undefined);

    expect(JSON.stringify(mockError.mock.calls)).not.toContain("SENTINEL-BODY");
  });
});
