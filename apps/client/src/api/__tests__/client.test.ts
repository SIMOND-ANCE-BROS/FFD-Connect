/**
 * Generated OpenAPI client wiring (api/client.ts): its 401 replay never
 * crosses an identity change (#893).
 */
type RequestFn = (request: Request) => Promise<Request>;
type ResponseFn = (response: Response, request: Request) => Promise<Response>;

const mockRequestFns: RequestFn[] = [];
const mockResponseFns: ResponseFn[] = [];
jest.mock("../generated/client.gen", () => ({
  client: {
    setConfig: jest.fn(),
    interceptors: {
      request: { use: (fn: RequestFn) => mockRequestFns.push(fn) },
      response: { use: (fn: ResponseFn) => mockResponseFns.push(fn) },
    },
  },
}));
jest.mock("../../config", () => ({ BACKEND_URL: "https://api.example" }));
jest.mock("../../services/analytics/usage", () => ({
  usage: { onApiSuccess: jest.fn() },
}));

const mockRefreshSession = jest.fn<Promise<string | null>, []>();
jest.mock("../sessionRefresh", () => ({
  refreshSession: () => mockRefreshSession(),
}));

let mockGeneration = 0;
jest.mock("../tokenStore", () => ({
  getAccessToken: async () => (mockGeneration === 0 ? "token-A" : "token-B"),
  getSessionGeneration: () => mockGeneration,
}));

beforeAll(() => {
  // Loaded once the interceptor arrays above exist (imports are hoisted).
  jest.requireActual<object>("../client");
});

const fetchMock = jest.fn<Promise<Response>, [Request]>();
const unauthorized = { status: 401, ok: false } as Response;

/** Runs a GET through the request interceptor, then the 401 handler. */
async function getThat401(): Promise<Response> {
  const sent = await mockRequestFns[0](
    new Request("https://api.example/users/me"),
  );
  return mockResponseFns[0](unauthorized, sent);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration = 0;
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ status: 200, ok: true } as Response);
});

describe("generated client 401 replay (#893)", () => {
  it("replays a GET once refreshed, same identity", async () => {
    mockRefreshSession.mockResolvedValue("token-A2");

    const response = await getThat401();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].headers.get("Authorization")).toBe(
      "Bearer token-A2",
    );
  });

  it("does not replay when the identity changed during the refresh", async () => {
    mockRefreshSession.mockImplementation(async () => {
      mockGeneration += 1;
      return "token-B";
    });

    const response = await getThat401();

    expect(response).toBe(unauthorized);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
