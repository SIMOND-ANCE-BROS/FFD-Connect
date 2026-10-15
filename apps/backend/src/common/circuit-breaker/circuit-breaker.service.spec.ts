import { RestError } from "@azure/storage-blob";
import { ServiceUnavailableException } from "@nestjs/common";
import { AxiosError, AxiosHeaders } from "axios";
import { EmailSendError } from "../../auth/email.service";
import { FfdDocumentHttpError } from "../../competitions/services/competition-events-deduction.service";
import {
  CircuitBreakerService,
  MAX_SCOPED_BREAKERS,
} from "./circuit-breaker.service";

describe("CircuitBreakerService", () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  it("executes the function and returns its result when closed", async () => {
    const result = await service.fire("azure-vision", () =>
      Promise.resolve("ok"),
    );
    expect(result).toBe("ok");
  });

  it("propagates errors from the wrapped function", async () => {
    await expect(
      service.fire("azure-tts", () => Promise.reject(new Error("TTS down"))),
    ).rejects.toThrow("TTS down");
  });

  it("opens the breaker after volumeThreshold failures", async () => {
    // Force 5+ failures to trip the breaker (volumeThreshold = 5, errorThreshold = 50%)
    for (let i = 0; i < 10; i++) {
      await service
        .fire("wdsf", () => Promise.reject(new Error("WDSF unavailable")))
        .catch(() => {});
    }
    // Next call should be rejected immediately with 503
    await expect(
      service.fire("wdsf", () => Promise.resolve("should not run")),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("throws ServiceUnavailableException (not the original error) when open", async () => {
    for (let i = 0; i < 10; i++) {
      await service
        .fire("azure-vision", () => Promise.reject(new Error("Vision down")))
        .catch(() => {});
    }
    await expect(
      service.fire("azure-vision", () => Promise.resolve("x")),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  describe("scoped breakers (#404)", () => {
    const fail = () => Promise.reject(new Error("down"));

    it("counts failures per scope: one tenant cannot open another's breaker", async () => {
      for (let i = 0; i < 5; i++) {
        await service.fire("helloasso", fail, "club-a").catch(() => undefined);
      }

      await expect(
        service.fire("helloasso", fail, "club-a"),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        service.fire("helloasso", () => Promise.resolve("ok"), "club-b"),
      ).resolves.toBe("ok");
      await expect(
        service.fire("helloasso", () => Promise.resolve("ok")),
      ).resolves.toBe("ok");
    });

    it("bounds the number of scoped breakers kept in memory", async () => {
      for (let i = 0; i <= MAX_SCOPED_BREAKERS; i++) {
        await service.fire("helloasso", () => Promise.resolve(i), `org-${i}`);
      }

      const breakers = (
        service as unknown as { breakers: Map<string, unknown> }
      ).breakers;
      expect(breakers.size).toBeLessThanOrEqual(MAX_SCOPED_BREAKERS);
      expect(breakers.has("helloasso:org-0")).toBe(false);
    });
  });

  // #437: a remote 4xx is the caller's fault and never opens the breaker.
  describe("caller errors (4xx) are not counted as outages", () => {
    const BREAKER_KEYS = [
      "azure-vision",
      "azure-tts",
      "wdsf",
      "helloasso",
      "fcm",
      "azure-blob",
      "azure-blob-write",
      "ffd-documents",
      "email",
      "email-auth",
    ] as const;
    const axiosError = (status: number) =>
      new AxiosError(
        `Request failed with status code ${status}`,
        "ERR_BAD_REQUEST",
        undefined,
        undefined,
        {
          status,
          statusText: "",
          headers: {},
          config: { headers: new AxiosHeaders() },
          data: null,
        },
      );

    // The error each caller really gets for a request the remote refuses.
    const CALLER_ERRORS: ReadonlyArray<
      [(typeof BREAKER_KEYS)[number], string, () => Error]
    > = [
      ["wdsf", "unknown MIN (HttpService 404)", () => axiosError(404)],
      ["azure-vision", "unreadable image (axios 400)", () => axiosError(400)],
      ["azure-tts", "refused SSML (axios 400)", () => axiosError(400)],
      ["helloasso", "refused checkout (axios 422)", () => axiosError(422)],
      [
        "fcm",
        "stale device token",
        () =>
          Object.assign(new Error("not registered"), {
            code: "messaging/registration-token-not-registered",
          }),
      ],
      [
        "azure-blob",
        "missing blob (RestError 404)",
        () => new RestError("BlobNotFound", { statusCode: 404 }),
      ],
      [
        "azure-blob-write",
        "refused write (RestError 409)",
        () => new RestError("BlobAlreadyExists", { statusCode: 409 }),
      ],
      [
        "ffd-documents",
        "withdrawn circular (HTTP 404)",
        () => new FfdDocumentHttpError(404),
      ],
      [
        "email",
        "refused address (Resend 422)",
        () => new EmailSendError("invalid to", 422),
      ],
      [
        "email-auth",
        "refused address (Resend 422)",
        () => new EmailSendError("invalid to", 422),
      ],
    ];
    const openWith = async (
      key: (typeof BREAKER_KEYS)[number],
      error: Error,
    ): Promise<void> => {
      for (let i = 0; i < 10; i++) {
        await service
          .fire(key, () => Promise.reject(error))
          .catch(() => undefined);
      }
    };

    it("covers every breaker key", () => {
      expect(CALLER_ERRORS.map(([key]) => key).sort()).toEqual(
        [...BREAKER_KEYS].sort(),
      );
    });

    it.each(CALLER_ERRORS)(
      "%s stays closed after a burst of caller errors (%s), rethrown unchanged",
      async (key, _label, makeError) => {
        const refused = makeError();
        for (let i = 0; i < 20; i++) {
          await expect(
            service.fire(key, () => Promise.reject(refused)),
          ).rejects.toBe(refused);
        }
        await expect(
          service.fire(key, () => Promise.resolve("ok")),
        ).resolves.toBe("ok");
      },
    );

    it.each(BREAKER_KEYS)("%s still opens on a burst of 5xx", async (key) => {
      await openWith(key, axiosError(503));
      await expect(
        service.fire(key, () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it.each([408, 429])("still opens on a burst of HTTP %i", async (status) => {
      await openWith("wdsf", axiosError(status));
      await expect(
        service.fire("wdsf", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // L1: one global credential (identity, API key) → 401/403 is an outage.
    const GLOBAL_CREDENTIAL_KEYS = BREAKER_KEYS.filter(
      (key) => key !== "helloasso",
    );
    describe.each([401, 403])("HTTP %i", (status) => {
      it.each(GLOBAL_CREDENTIAL_KEYS)(
        "opens the global-credential breaker %s",
        async (key) => {
          await openWith(key, axiosError(status));
          await expect(
            service.fire(key, () => Promise.resolve("ok")),
          ).rejects.toBeInstanceOf(ServiceUnavailableException);
        },
      );

      it("opens on Azure RestError and Resend refusals of our key", async () => {
        await openWith(
          "azure-blob",
          new RestError("AuthorizationFailure", { statusCode: status }),
        );
        await openWith("email", new EmailSendError("bad key", status));
        await expect(
          service.fire("azure-blob", () => Promise.resolve("ok")),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        await expect(
          service.fire("email", () => Promise.resolve("ok")),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      });

      it("never opens helloasso (per-club credentials)", async () => {
        await openWith("helloasso", axiosError(status));
        await expect(
          service.fire("helloasso", () => Promise.resolve("ok")),
        ).resolves.toBe("ok");
      });
    });

    it("counts FCM mismatched-credential (wrong Firebase project) as an outage", async () => {
      await openWith(
        "fcm",
        Object.assign(new Error("mismatched"), {
          code: "messaging/mismatched-credential",
        }),
      );
      await expect(
        service.fire("fcm", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // L2: forgot-password floods only open their own breaker.
    it("an open email-auth breaker leaves email closed", async () => {
      await openWith("email-auth", new EmailSendError("rate limited", 429));
      await expect(
        service.fire("email-auth", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        service.fire("email", () => Promise.resolve("ok")),
      ).resolves.toBe("ok");
    });

    // L3: a remote payload carrying `status` never hides an outage.
    it("counts an error whose remote body says 404", async () => {
      await openWith(
        "wdsf",
        Object.assign(new Error("down"), { response: { status: 404 } }),
      );
      await openWith(
        "azure-tts",
        new ServiceUnavailableException({ status: 404 }),
      );
      await expect(
        service.fire("wdsf", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        service.fire("azure-tts", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("still opens on a burst of timeouts", async () => {
      const timeout = new Error("[Timeout] blob read timed out after 10000ms");
      for (let i = 0; i < 10; i++) {
        await service
          .fire("azure-blob", () => Promise.reject(timeout))
          .catch(() => undefined);
      }
      await expect(
        service.fire("azure-blob", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("ignores invalid FCM tokens but counts FCM server errors", async () => {
      const staleToken = Object.assign(new Error("stale"), {
        code: "messaging/registration-token-not-registered",
      });
      for (let i = 0; i < 10; i++) {
        await service
          .fire("fcm", () => Promise.reject(staleToken))
          .catch(() => undefined);
      }
      await expect(
        service.fire("fcm", () => Promise.resolve("ok")),
      ).resolves.toBe("ok");

      service = new CircuitBreakerService();
      const unavailable = Object.assign(new Error("down"), {
        code: "messaging/server-unavailable",
      });
      for (let i = 0; i < 10; i++) {
        await service
          .fire("fcm", () => Promise.reject(unavailable))
          .catch(() => undefined);
      }
      await expect(
        service.fire("fcm", () => Promise.resolve("ok")),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
