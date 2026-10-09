import type { SimulationContext } from "./store-review.decorator";
import {
  genericSimulatedResponse,
  simulatedCheckIn,
  simulatedDeleteCount,
  simulatedPartnership,
  simulatedRenewalDocument,
  simulatedRenewalStart,
  simulatedRenewalSubmit,
  simulatedVolunteerToken,
} from "./store-review-responses";

const NOW = new Date("2026-10-09T10:00:00.000Z");

const ctx = (over: Partial<SimulationContext> = {}): SimulationContext => {
  let n = 0;
  return {
    userId: "review-1",
    params: {},
    body: undefined,
    now: NOW,
    newId: () => `id-${++n}`,
    ...over,
  };
};

describe("store-review simulated responses", () => {
  describe("genericSimulatedResponse", () => {
    it("echoes the body with an id, timestamps and the success flags", () => {
      expect(
        genericSimulatedResponse(ctx({ body: { name: "Solo", level: "A" } })),
      ).toEqual({
        name: "Solo",
        level: "A",
        id: "id-1",
        success: true,
        simulated: true,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      });
    });

    it("keeps the route :id over a body id", () => {
      expect(
        genericSimulatedResponse(
          ctx({ params: { id: "route-id" }, body: { id: "body-id" } }),
        ),
      ).toMatchObject({ id: "route-id" });
    });

    it("never echoes credentials", () => {
      const res = genericSimulatedResponse(
        ctx({
          body: {
            currentPassword: "a",
            newPassword: "b",
            password: "c",
            refresh_token: "d",
            clientSecret: "e",
            keep: 1,
          },
        }),
      );
      expect(Object.keys(res).sort()).toEqual(
        ["keep", "id", "success", "simulated", "createdAt", "updatedAt"].sort(),
      );
    });

    it.each([null, "text", ["a"], 42])(
      "ignores a non-object body (%p)",
      (body) => {
        expect(genericSimulatedResponse(ctx({ body }))).toEqual({
          id: "id-1",
          success: true,
          simulated: true,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        });
      },
    );
  });

  it("DELETE /notifications reports a count", () => {
    expect(simulatedDeleteCount(ctx())).toEqual({
      count: 0,
      success: true,
      simulated: true,
    });
  });

  describe("license renewal", () => {
    it("start returns an empty draft of the account", () => {
      expect(simulatedRenewalStart(ctx())).toEqual({
        id: "id-1",
        userId: "review-1",
        status: "DRAFT",
        documents: [],
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        simulated: true,
      });
    });

    it("an upload reports both required documents so submit is enabled", () => {
      const res = simulatedRenewalDocument(
        ctx({ params: { id: "req-1" } }),
      ) as {
        id: string;
        status: string;
        documents: { type: string; requestId: string }[];
      };
      expect(res.id).toBe("req-1");
      expect(res.status).toBe("DRAFT");
      expect(res.documents.map((d) => d.type)).toEqual([
        "MEDICAL_CERTIFICATE",
        "LICENSE_CERTIFICATE",
      ]);
      expect(res.documents.every((d) => d.requestId === "req-1")).toBe(true);
    });

    it("submit returns a pending request", () => {
      expect(
        simulatedRenewalSubmit(ctx({ params: { id: "req-1" } })),
      ).toMatchObject({ id: "req-1", status: "PENDING" });
    });

    it("falls back to a fresh id without a route :id", () => {
      expect(simulatedRenewalDocument(ctx())).toMatchObject({ id: "id-1" });
      expect(simulatedRenewalSubmit(ctx())).toMatchObject({ id: "id-1" });
    });
  });

  it("check-in returns a user and one successful registration", () => {
    const res = simulatedCheckIn(ctx()) as {
      user: { firstName: string };
      registrations: { status: string }[];
    };
    expect(res.user.firstName).toBeTruthy();
    expect(res.registrations).toEqual([
      expect.objectContaining({ status: "SUCCESS" }),
    ]);
  });

  describe("volunteer token", () => {
    it("returns a link for the competition with the given name", () => {
      expect(
        simulatedVolunteerToken(
          ctx({ params: { id: "comp-1" }, body: { name: "Marie" } }),
        ),
      ).toEqual({
        id: "id-2",
        token: "id-1",
        competitionId: "comp-1",
        expiresAt: "2026-10-10T10:00:00.000Z",
        name: "Marie",
        accessUrl:
          "https://ffd-connect.fr/volunteer/checkin?token=id-1&id=comp-1",
        simulated: true,
      });
    });

    it.each([undefined, { name: "  " }, { name: 3 }])(
      "defaults the name (%p) and tolerates a missing :id",
      (body) => {
        expect(simulatedVolunteerToken(ctx({ body }))).toMatchObject({
          name: "Bénévole",
          competitionId: "",
        });
      },
    );
  });

  it("partnership creation returns the fields the club screen reads", () => {
    expect(
      simulatedPartnership(ctx({ body: { user1Id: "a", user2Id: "b" } })),
    ).toEqual({
      partnership: {
        user1Id: "a",
        user2Id: "b",
        id: "id-1",
        status: "ACTIVE",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      suggestedCategories: [],
      coupleAgeGroup: null,
      suggestedLevel: null,
      simulated: true,
    });
  });
});
