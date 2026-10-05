import { ExecutionContext, CallHandler } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { MetricsInterceptor } from "./metrics.interceptor";
import { MetricsService } from "./metrics.service";

describe("MetricsInterceptor", () => {
  let interceptor: MetricsInterceptor;
  const mockMetricsService = {
    recordHttpMetric: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new MetricsInterceptor(
      mockMetricsService as unknown as MetricsService,
    );
  });

  function createMockContext(
    method: string,
    url: string,
    statusCode: number,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, url }),
        getResponse: () => ({ statusCode }),
      }),
    } as unknown as ExecutionContext;
  }

  it("records HTTP metric on successful response", (done) => {
    const context = createMockContext("GET", "/api/tracks", 200);
    const next: CallHandler = { handle: () => of("data") };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        expect(mockMetricsService.recordHttpMetric).toHaveBeenCalledTimes(1);
        const call = mockMetricsService.recordHttpMetric.mock.calls[0][0];
        expect(call.method).toBe("GET");
        expect(call.endpoint).toBe("/api/tracks");
        expect(call.statusCode).toBe(200);
        expect(typeof call.duration).toBe("number");
        done();
      },
    });
  });

  it("records HTTP metric on error with statusCode or 500", (done) => {
    const context = createMockContext("POST", "/api/login", 401);
    const next: CallHandler = {
      handle: () => throwError(() => new Error("Unauthorized")),
    };

    interceptor.intercept(context, next).subscribe({
      error: () => {
        expect(mockMetricsService.recordHttpMetric).toHaveBeenCalledTimes(1);
        const call = mockMetricsService.recordHttpMetric.mock.calls[0][0];
        expect(call.statusCode).toBe(401);
        done();
      },
    });
  });
});
