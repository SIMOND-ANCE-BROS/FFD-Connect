import { CallHandler, ExecutionContext } from "@nestjs/common";
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { LicensesController } from "./licenses.controller";
import { lastValueFrom, of } from "rxjs";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import {
  carriesHealthData,
  ImpersonatedRenewalAccessInterceptor,
  routeTemplate,
} from "./impersonated-renewal-access.interceptor";

describe("ImpersonatedRenewalAccessInterceptor (#63)", () => {
  const healthAccess = { record: jest.fn() };
  const interceptor = new ImpersonatedRenewalAccessInterceptor(
    healthAccess as unknown as HealthDataAccessLogService,
  );

  const withMedical = {
    id: "req-1",
    userId: "user-1",
    rejectionReason: null,
    documents: [{ id: "doc-1", type: "MEDICAL_CERTIFICATE" }],
  };

  const contextFor = (user: Partial<RequestWithUser["user"]>) => {
    const req = {
      method: "GET",
      route: { path: "/api/v1/licenses/renewal/my" },
      user: { userId: "user-1", ...user },
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  };
  const handlerReturning = (body: unknown): CallHandler => ({
    handle: () => of(body),
  });

  beforeEach(() => {
    healthAccess.record.mockReset().mockResolvedValue(undefined);
  });

  it("does nothing for the licensee's own session", async () => {
    const body = await lastValueFrom(
      interceptor.intercept(contextFor({}), handlerReturning(withMedical)),
    );
    expect(body).toBe(withMedical);
    expect(healthAccess.record).not.toHaveBeenCalled();
  });

  it("traces a read by an impersonator before the response leaves", async () => {
    const body = await lastValueFrom(
      interceptor.intercept(
        contextFor({ impersonatedBy: "staff-1" }),
        handlerReturning(withMedical),
      ),
    );

    expect(body).toBe(withMedical);
    expect(healthAccess.record).toHaveBeenCalledWith([
      {
        subjectUserId: "user-1",
        actorUserId: "staff-1",
        actorRole: "IMPERSONATOR",
        action: "READ",
        resourceType: "LICENSE_RENEWAL_REQUEST",
        resourceId: "req-1",
        route: "GET /licenses/renewal/my",
      },
    ]);
  });

  it("fails the request when the trace cannot be written", async () => {
    healthAccess.record.mockRejectedValue(new Error("db down"));
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor({ impersonatedBy: "staff-1" }),
          handlerReturning(withMedical),
        ),
      ),
    ).rejects.toThrow("db down");
  });

  it.each([
    ["no request", null],
    ["a request without medical data", { id: "req-1", documents: [] }],
    [
      "a licence certificate only",
      { id: "req-1", documents: [{ type: "LICENSE_CERTIFICATE" }] },
    ],
  ])("writes nothing for %s", async (_label, response) => {
    await lastValueFrom(
      interceptor.intercept(
        contextFor({ impersonatedBy: "staff-1" }),
        handlerReturning(response),
      ),
    );
    expect(healthAccess.record).not.toHaveBeenCalled();
  });

  describe("carriesHealthData", () => {
    it("a medical refusal reason is health data, even without document", () => {
      expect(
        carriesHealthData({
          id: "r",
          rejectionReason: "MEDICAL_RESTRICTION",
          documents: [],
        }),
      ).toBe(true);
    });

    it("a neutral reason without certificate is not", () => {
      expect(carriesHealthData({ id: "r", rejectionReason: "OTHER" })).toBe(
        false,
      );
    });
  });

  it.each([
    "startRenewal",
    "getMyRenewal",
    "uploadRenewalDocument",
    "submitRenewal",
  ] as const)(
    "is applied to LicensesController.%s (responses carry OCR hints)",
    (method) => {
      const interceptors = Reflect.getMetadata(
        INTERCEPTORS_METADATA,
        LicensesController.prototype[method],
      ) as unknown[];
      expect(interceptors).toContain(ImpersonatedRenewalAccessInterceptor);
    },
  );

  describe("routeTemplate", () => {
    it("falls back when the route is unknown", () => {
      expect(
        routeTemplate({ method: "POST" } as unknown as RequestWithUser),
      ).toBe("POST (unknown)");
    });
  });
});
