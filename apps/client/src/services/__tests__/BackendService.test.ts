import { BackendService } from "../BackendService";
import { httpGet, httpPost, httpRequest } from "../../utils/httpInterceptor";

jest.mock("../../utils/httpInterceptor", () => ({
  httpGet: jest.fn(),
  httpPost: jest.fn(),
  httpRequest: jest.fn(),
}));

jest.mock("expo-file-system", () => ({
  downloadAsync: jest.fn(),
  uploadAsync: jest.fn(),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  documentDirectory: "file:///documents/",
  readAsStringAsync: jest.fn(),
}));

jest.mock("expo-file-system/legacy", () => ({
  downloadAsync: jest.fn(),
  uploadAsync: jest.fn(),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  documentDirectory: "file:///documents/",
  readAsStringAsync: jest.fn(),
  FileSystemUploadType: {
    BINARY_CONTENT: "BINARY_CONTENT",
    MULTIPART: "MULTIPART",
  },
}));

jest.mock("../../config", () => ({ BACKEND_URL: "http://localhost:3000" }));

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const mockHttpGet = httpGet as jest.MockedFunction<typeof httpGet>;
const mockHttpPost = httpPost as jest.MockedFunction<typeof httpPost>;
const mockHttpRequest = httpRequest as jest.MockedFunction<typeof httpRequest>;

describe("BackendService", () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── getTrack ────────────────────────────────────────────────────────────────

  describe("getTrack", () => {
    it("calls httpGet with the correct URL", async () => {
      const result = {
        id: "track-1",
        title: "Song",
        artist: "Artist",
        bpm: 120,
        filename: "song.mp3",
      };
      mockHttpGet.mockResolvedValue(result);

      const res = await BackendService.getTrack("track-1");

      expect(mockHttpGet).toHaveBeenCalledWith(
        "http://localhost:3000/tracks/track-1",
        expect.any(Object),
      );
      expect(res).toEqual(result);
    });
  });

  // ─── checkHealth ────────────────────────────────────────────────────────────

  describe("checkHealth", () => {
    it("returns true when fetch responds with ok", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await BackendService.checkHealth();

      expect(result).toBe(true);
    });

    it("returns true when status is 404 (backend reachable)", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await BackendService.checkHealth();

      expect(result).toBe(true);
    });

    it("returns false when fetch throws (network unavailable)", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

      const result = await BackendService.checkHealth();

      expect(result).toBe(false);
    });
  });

  // ─── getMyLicense ───────────────────────────────────────────────────────────

  describe("getMyLicense", () => {
    it("calls httpGet with Authorization header", async () => {
      mockHttpGet.mockResolvedValue({ id: "lic-1" });

      await BackendService.getMyLicense("token-abc");

      expect(mockHttpGet).toHaveBeenCalledWith(
        "http://localhost:3000/licenses/my",
        expect.objectContaining({
          headers: { Authorization: "Bearer token-abc" },
        }),
      );
    });
  });

  // ─── Career ─────────────────────────────────────────────────────────────────

  describe("getMyCareer", () => {
    it("calls httpGet /career/me with auth header", async () => {
      mockHttpGet.mockResolvedValue({
        partnerships: [],
        registrations: [],
        results: [],
      });

      await BackendService.getMyCareer("tok");

      expect(mockHttpGet).toHaveBeenCalledWith(
        "http://localhost:3000/career/me",
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      );
    });
  });

  describe("getUserCareer", () => {
    it("calls httpGet /career/user/:id", async () => {
      mockHttpGet.mockResolvedValue({
        partnerships: [],
        registrations: [],
        results: [],
      });

      await BackendService.getUserCareer("tok", "user-42");

      expect(mockHttpGet).toHaveBeenCalledWith(
        "http://localhost:3000/career/user/user-42",
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      );
    });
  });

  describe("searchCareerMembers", () => {
    it("returns empty array when query is too short", async () => {
      const result = await BackendService.searchCareerMembers("tok", "a");
      expect(result).toEqual([]);
      expect(mockHttpGet).not.toHaveBeenCalled();
    });

    it("returns empty array when query is blank", async () => {
      const result = await BackendService.searchCareerMembers("tok", "  ");
      expect(result).toEqual([]);
    });

    it("calls httpGet with trimmed query when long enough", async () => {
      mockHttpGet.mockResolvedValue([{ id: "u1" }]);

      await BackendService.searchCareerMembers("tok", "  Dupont  ");

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining("q=Dupont"),
        expect.any(Object),
      );
    });
  });

  // ─── Renewal ────────────────────────────────────────────────────────────────

  describe("startRenewalRequest", () => {
    it("calls httpPost /licenses/renewal/start", async () => {
      mockHttpPost.mockResolvedValue({
        id: "req-1",
        status: "DRAFT",
        documents: [],
      });

      await BackendService.startRenewalRequest("tok");

      expect(mockHttpPost).toHaveBeenCalledWith(
        "http://localhost:3000/licenses/renewal/start",
        {},
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      );
    });
  });

  describe("getMyRenewalRequest", () => {
    it("returns the request data", async () => {
      const req = { id: "req-1", status: "DRAFT", documents: [] };
      mockHttpGet.mockResolvedValue(req);

      const result = await BackendService.getMyRenewalRequest("tok");

      expect(result).toEqual(req);
    });

    it("returns null when data is null", async () => {
      mockHttpGet.mockResolvedValue(null);

      const result = await BackendService.getMyRenewalRequest("tok");

      expect(result).toBeNull();
    });
  });

  describe("submitRenewalRequest", () => {
    it("calls httpPost /licenses/renewal/:id/submit", async () => {
      mockHttpPost.mockResolvedValue({
        id: "req-1",
        status: "PENDING",
        documents: [],
      });

      await BackendService.submitRenewalRequest("tok", "req-1");

      expect(mockHttpPost).toHaveBeenCalledWith(
        "http://localhost:3000/licenses/renewal/req-1/submit",
        {},
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      );
    });
  });

  // ─── Notifications ──────────────────────────────────────────────────────────

  describe("getNotifications", () => {
    it("calls httpGet /notifications with auth", async () => {
      mockHttpGet.mockResolvedValue([]);

      await BackendService.getNotifications("tok");

      expect(mockHttpGet).toHaveBeenCalledWith(
        "http://localhost:3000/notifications",
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      );
    });
  });

  describe("markNotificationAsRead", () => {
    it("calls httpRequest PATCH /notifications/:id/read", async () => {
      mockHttpRequest.mockResolvedValue(undefined);

      await BackendService.markNotificationAsRead("tok", "notif-1");

      expect(mockHttpRequest).toHaveBeenCalledWith(
        "http://localhost:3000/notifications/notif-1/read",
        expect.objectContaining({
          method: "PATCH",
          headers: { Authorization: "Bearer tok" },
        }),
      );
    });
  });

  describe("markAllNotificationsAsRead", () => {
    it("calls httpPost /notifications/read-all", async () => {
      mockHttpPost.mockResolvedValue(undefined);

      await BackendService.markAllNotificationsAsRead("tok");

      expect(mockHttpPost).toHaveBeenCalledWith(
        "http://localhost:3000/notifications/read-all",
        {},
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      );
    });
  });

  // ─── uploadRenewalDocument ───────────────────────────────────────────────────

  describe("uploadRenewalDocument", () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      global.fetch = mockFetch;
    });

    describe("on native platform", () => {
      it("uploads via fetch with form data and returns parsed JSON", async () => {
        const responseData = { id: "req-1", status: "DRAFT" };
        mockFetch.mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue(responseData),
        });

        const result = await BackendService.uploadRenewalDocument(
          "tok",
          "req-1",
          "MEDICAL_CERTIFICATE",
          "file:///path/doc.jpg",
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3000/licenses/renewal/req-1/documents",
          expect.objectContaining({
            method: "POST",
            headers: { Authorization: "Bearer tok" },
          }),
        );
        expect(result).toEqual(responseData);
      });

      it("throws when response is not ok", async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 422,
          json: jest.fn().mockResolvedValue({ message: "Validation failed" }),
        });

        await expect(
          BackendService.uploadRenewalDocument(
            "tok",
            "req-1",
            "MEDICAL_CERTIFICATE",
            "file:///path/doc.jpg",
          ),
        ).rejects.toThrow("Validation failed");
      });

      it("throws with fallback message when error response has no message", async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          json: jest.fn().mockResolvedValue({}),
        });

        await expect(
          BackendService.uploadRenewalDocument(
            "tok",
            "req-1",
            "MEDICAL_CERTIFICATE",
            "file:///path/doc.jpg",
          ),
        ).rejects.toThrow("Upload failed 500");
      });
    });

    describe("on web platform", () => {
      beforeEach(() => {
        jest.requireMock("react-native").Platform.OS = "web";

        const FileSystem = jest.requireMock("expo-file-system/legacy");
        // minimal base64 for a 1-byte file ('A' = 0x41)
        FileSystem.readAsStringAsync.mockResolvedValue("QQ==");

        global.atob = (s: string) =>
          Buffer.from(s, "base64").toString("binary");
      });

      afterEach(() => {
        jest.requireMock("react-native").Platform.OS = "ios";
      });

      it("uploads via fetch on web and returns parsed JSON", async () => {
        const responseData = { id: "req-web", status: "DRAFT" };
        mockFetch.mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue(responseData),
        });

        const result = await BackendService.uploadRenewalDocument(
          "tok",
          "req-web",
          "LICENSE_CERTIFICATE",
          "file:///path/doc.jpg",
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3000/licenses/renewal/req-web/documents",
          expect.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(responseData);
      });

      it("throws when web response is not ok", async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          json: jest.fn().mockResolvedValue({ message: "Bad request" }),
        });

        await expect(
          BackendService.uploadRenewalDocument(
            "tok",
            "req-web",
            "LICENSE_CERTIFICATE",
            "file:///path/doc.jpg",
          ),
        ).rejects.toThrow("Bad request");
      });
    });
  });

  // ─── renewLicense ────────────────────────────────────────────────────────────

  describe("renewLicense", () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      global.fetch = mockFetch;
      const FileSystem = jest.requireMock("expo-file-system/legacy");
      FileSystem.readAsStringAsync.mockResolvedValue("base64content");
    });

    describe("on native platform", () => {
      it("uploads via FileSystem.uploadAsync and returns parsed body", async () => {
        const FileSystem = jest.requireMock("expo-file-system");
        FileSystem.uploadAsync.mockResolvedValue({
          status: 200,
          body: JSON.stringify({ ok: true }),
        });

        const result = await BackendService.renewLicense(
          "tok",
          "file:///path/cert.jpg",
        );

        expect(FileSystem.uploadAsync).toHaveBeenCalledWith(
          "http://localhost:3000/licenses/renew",
          "/path/cert.jpg",
          expect.objectContaining({
            httpMethod: "POST",
            fieldName: "certificate",
            headers: { Authorization: "Bearer tok" },
          }),
        );
        expect(result).toEqual({ ok: true });
      });

      it("throws when uploadAsync status is not 200 or 201", async () => {
        const FileSystem = jest.requireMock("expo-file-system");
        FileSystem.uploadAsync.mockResolvedValue({
          status: 500,
          body: "",
        });

        await expect(
          BackendService.renewLicense("tok", "file:///path/cert.jpg"),
        ).rejects.toThrow("Upload failed with status 500");
      });

      it("accepts status 201 as success", async () => {
        const FileSystem = jest.requireMock("expo-file-system");
        FileSystem.uploadAsync.mockResolvedValue({
          status: 201,
          body: JSON.stringify({ created: true }),
        });

        const result = await BackendService.renewLicense(
          "tok",
          "file:///path/cert.jpg",
        );
        expect(result).toEqual({ created: true });
      });
    });

    describe("on web platform", () => {
      beforeEach(() => {
        jest.requireMock("react-native").Platform.OS = "web";
        global.atob = (s: string) =>
          Buffer.from(s, "base64").toString("binary");
      });

      afterEach(() => {
        jest.requireMock("react-native").Platform.OS = "ios";
      });

      it("uploads via fetch on web and returns JSON", async () => {
        const responseData = { success: true };
        mockFetch.mockResolvedValue({
          status: 200,
          json: jest.fn().mockResolvedValue(responseData),
        });

        const result = await BackendService.renewLicense(
          "tok",
          "file:///path/cert.jpg",
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3000/licenses/renew",
          expect.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(responseData);
      });

      it("throws when web response status is not 200 or 201", async () => {
        mockFetch.mockResolvedValue({ status: 422 });

        await expect(
          BackendService.renewLicense("tok", "file:///path/cert.jpg"),
        ).rejects.toThrow("Upload failed with status 422");
      });
    });
  });
});
