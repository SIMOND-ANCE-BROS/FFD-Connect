import {
  trackCorrectionsControllerApprove,
  trackCorrectionsControllerCreate,
  trackCorrectionsControllerList,
  trackCorrectionsControllerListMine,
  trackCorrectionsControllerPendingCount,
  trackCorrectionsControllerReject,
} from "../../../api/generated";
import {
  TrackCorrectionApi,
  TrackCorrectionApiError,
  toTrackCorrectionError,
} from "../track-correction-api";

jest.mock("../../../api/generated", () => ({
  trackCorrectionsControllerApprove: jest.fn(),
  trackCorrectionsControllerCreate: jest.fn(),
  trackCorrectionsControllerList: jest.fn(),
  trackCorrectionsControllerListMine: jest.fn(),
  trackCorrectionsControllerPendingCount: jest.fn(),
  trackCorrectionsControllerReject: jest.fn(),
}));

const ok = <T>(data: T) => ({
  data,
  error: undefined,
  response: { status: 200 },
});
const fail = (status?: number) => ({
  data: undefined,
  error: { message: "boom" },
  response: status === undefined ? undefined : { status },
});

beforeEach(() => jest.clearAllMocks());

describe("TrackCorrectionApi", () => {
  it("create envoie le corps tel quel et renvoie la proposition", async () => {
    const created = { id: "c1" };
    (trackCorrectionsControllerCreate as jest.Mock).mockResolvedValue(
      ok(created),
    );
    const body = { trackId: "t1", reason: "MPM" as const, bpm: 52 };

    await expect(TrackCorrectionApi.create(body)).resolves.toBe(created);
    expect(trackCorrectionsControllerCreate).toHaveBeenCalledWith({ body });
  });

  it.each([
    [400, "Rien à corriger"],
    [404, "plus disponible"],
    [429, "déjà plusieurs propositions en attente"],
  ])("create traduit le %i en message français", async (status, fragment) => {
    (trackCorrectionsControllerCreate as jest.Mock).mockResolvedValue(
      fail(status),
    );
    const error = await TrackCorrectionApi.create({
      trackId: "t1",
      reason: "OTHER",
      message: "x",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TrackCorrectionApiError);
    expect((error as TrackCorrectionApiError).status).toBe(status);
    expect((error as Error).message).toContain(fragment);
  });

  it("create sans réponse HTTP (réseau) → message générique", async () => {
    (trackCorrectionsControllerCreate as jest.Mock).mockResolvedValue(fail());
    await expect(
      TrackCorrectionApi.create({ trackId: "t1", reason: "OTHER" }),
    ).rejects.toThrow("L'envoi de la proposition a échoué");
  });

  it("listMine et list transmettent la pagination et le statut", async () => {
    const page = {
      data: [],
      meta: { total: 0, skip: 0, take: 50, hasMore: false },
    };
    (trackCorrectionsControllerListMine as jest.Mock).mockResolvedValue(
      ok(page),
    );
    (trackCorrectionsControllerList as jest.Mock).mockResolvedValue(ok(page));

    await expect(TrackCorrectionApi.listMine({ take: 50 })).resolves.toBe(page);
    await expect(
      TrackCorrectionApi.list({ status: "PENDING", take: 50 }),
    ).resolves.toBe(page);

    expect(trackCorrectionsControllerListMine).toHaveBeenCalledWith({
      query: { take: 50 },
    });
    expect(trackCorrectionsControllerList).toHaveBeenCalledWith({
      query: { status: "PENDING", take: 50 },
    });
  });

  it("pendingCount renvoie le compteur", async () => {
    (trackCorrectionsControllerPendingCount as jest.Mock).mockResolvedValue(
      ok({ count: 4 }),
    );
    await expect(TrackCorrectionApi.pendingCount()).resolves.toBe(4);
  });

  it("approve passe l'id et les ajustements", async () => {
    (trackCorrectionsControllerApprove as jest.Mock).mockResolvedValue(
      ok({ id: "c1" }),
    );
    await TrackCorrectionApi.approve("c1", { bpm: 50, comment: "ok" });
    expect(trackCorrectionsControllerApprove).toHaveBeenCalledWith({
      path: { id: "c1" },
      body: { bpm: 50, comment: "ok" },
    });
  });

  it("reject sans commentaire envoie un corps vide", async () => {
    (trackCorrectionsControllerReject as jest.Mock).mockResolvedValue(
      ok({ id: "c1" }),
    );
    await TrackCorrectionApi.reject("c1");
    expect(trackCorrectionsControllerReject).toHaveBeenCalledWith({
      path: { id: "c1" },
      body: {},
    });
  });

  it("un 409 à la validation signale une proposition déjà traitée", async () => {
    (trackCorrectionsControllerApprove as jest.Mock).mockResolvedValue(
      fail(409),
    );
    const error = await TrackCorrectionApi.approve("c1").catch(
      (e: unknown) => e,
    );
    expect((error as TrackCorrectionApiError).status).toBe(409);
    expect((error as Error).message).toBe(
      "Cette proposition a déjà été traitée.",
    );
  });

  it("toTrackCorrectionError retombe sur un message générique", () => {
    expect(toTrackCorrectionError("load", 500).message).toBeTruthy();
    expect(toTrackCorrectionError("review", 500).status).toBe(500);
  });
});
