import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { UploadedFile } from "../utils/file-validation.util";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsService } from "./reports.service";

describe("ReportsService", () => {
  let service: ReportsService;
  let mockFetch: jest.Mock;

  const mockPrisma = {
    bugReport: {
      create: jest.fn(),
    },
  };

  const mockReportData: CreateReportDto = {
    userId: "u1",
    title: "Bug",
    description: "Desc",
    type: "BUG",
    module: "Connexion",
    severity: "HIGH",
    appVersion: "1.0.0",
    steps: "Steps",
    stackTrace: "Trace",
    deviceInfo: "iPhone",
    logs: "Logs",
  };

  beforeEach(async () => {
    // Mock global fetch
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: { download_url: "http://img.url" },
        html_url: "http://issue.url",
      }),
      text: jest.fn().mockResolvedValue("OK"),
    });
    global.fetch = mockFetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                GITHUB_TOKEN: "token",
                GITHUB_OWNER: "owner",
                GITHUB_REPO: "repo",
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 50));

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should save report to DB and attempt GitHub issue creation", async () => {
      mockPrisma.bugReport.create.mockResolvedValue({ id: "r1" });

      await service.create(mockReportData);

      // Wait for fire-and-forget createGitHubIssue
      await flushPromises();

      expect(mockPrisma.bugReport.create).toHaveBeenCalled();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://api.github.com/repos/owner/repo/issues",
        ),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Bug"),
        }),
      );
    });

    it("should handle image upload if file is provided", async () => {
      const mockFile: Partial<UploadedFile> = {
        originalname: "test.png",
        buffer: Buffer.from("fake-image"),
      };

      await service.create(mockReportData, mockFile as never);

      // Wait for fire-and-forget createGitHubIssue
      await flushPromises();

      // Should have two fetch calls: 1 for content upload, 1 for issue creation
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should still create DB record even if GitHub fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve("Error"),
      });
      mockPrisma.bugReport.create.mockResolvedValue({ id: "r1" });

      await service.create(mockReportData);
      await flushPromises();

      expect(mockPrisma.bugReport.create).toHaveBeenCalled();
    });

    it("should log and continue when image upload to GitHub fails", async () => {
      const mockFile: Partial<UploadedFile> = {
        originalname: "screen.png",
        buffer: Buffer.from("img"),
      };

      // First call: image upload (fails)
      // Second call: issue creation (succeeds)
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          text: jest.fn().mockResolvedValue("Upload error"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            html_url: "http://issue.url",
          }),
          text: jest.fn().mockResolvedValue("OK"),
        });

      mockPrisma.bugReport.create.mockResolvedValue({ id: "r1" });

      await service.create(mockReportData, mockFile as never);
      await flushPromises();

      // We attempted both upload and issue creation even after the upload failure
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain("/contents/");
      expect(mockFetch.mock.calls[1][0]).toContain("/issues");
      expect(mockPrisma.bugReport.create).toHaveBeenCalled();
    });

    it("should handle FEATURE type", async () => {
      const enhancementData: CreateReportDto = {
        ...mockReportData,
        type: "FEATURE",
      };
      await service.create(enhancementData);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("enhancement"),
        }),
      );
    });

    it("should skip GitHub if env vars are missing", async () => {
      const noGithubModule = await Test.createTestingModule({
        providers: [
          ReportsService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
        ],
      }).compile();
      const noGithubService =
        noGithubModule.get<ReportsService>(ReportsService);
      mockFetch.mockClear();
      await noGithubService.create(mockReportData);
      await flushPromises();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
