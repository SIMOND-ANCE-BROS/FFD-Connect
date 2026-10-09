import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert, type AlertButton } from "react-native";
import {
  TrackCorrectionApi,
  TrackCorrectionApiError,
  type TrackCorrectionAdminDto,
} from "../../../../services/api/track-correction-api";
import { useAuthStore } from "../../../../stores/auth.store";
import { useLibrarySyncStore } from "../../../../stores/librarySync.store";
import { TrackCorrectionsReviewScreen } from "../TrackCorrectionsReviewScreen";

jest.mock("../../../../services/api/track-correction-api", () => {
  const actual = jest.requireActual<
    typeof import("../../../../services/api/track-correction-api")
  >("../../../../services/api/track-correction-api");
  return {
    ...actual,
    TrackCorrectionApi: {
      list: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    },
  };
});

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      background: "#fff",
      surface: "#f2f2f2",
      text: "#111",
      textSecondary: "#666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      danger: "#ef4444",
      success: "#10B981",
      warning: "#F59E0B",
    },
    isDark: false,
  }),
}));

const api = TrackCorrectionApi as unknown as {
  list: jest.Mock;
  approve: jest.Mock;
  reject: jest.Mock;
};

const correction = (
  overrides: Partial<TrackCorrectionAdminDto> = {},
): TrackCorrectionAdminDto => ({
  id: "c1",
  trackId: "t1",
  reason: "MPM",
  status: "PENDING",
  proposed: {
    title: null,
    artist: null,
    style: null,
    bpm: 62,
    clashTimecodes: null,
  },
  message: "Compté au métronome",
  reviewComment: null,
  reviewedAt: null,
  createdAt: "2026-10-06T10:00:00Z",
  track: {
    id: "t1",
    title: "España Cañí",
    artist: "Orchestre",
    style: "Paso Doble",
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: "espana-cani.mp3",
  },
  proposer: { id: "u1", name: "Eva Martin" },
  reviewer: null,
  resultingBpm: 62,
  ...overrides,
});

const page = (data: TrackCorrectionAdminDto[]) => ({
  data,
  meta: { total: data.length, skip: 0, take: 20, hasMore: false },
});

/** Simule un tap sur le bouton `text` de la boîte de confirmation. */
const confirmWith = (text: string) =>
  jest
    .spyOn(Alert, "alert")
    .mockImplementation(
      (_title: string, _msg?: string, buttons?: AlertButton[]) => {
        buttons?.find((b) => b.text === text)?.onPress?.();
      },
    );

const renderScreen = (correctionId?: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  return render(
    <QueryClientProvider client={client}>
      <TrackCorrectionsReviewScreen
        navigation={
          navigation as unknown as React.ComponentProps<
            typeof TrackCorrectionsReviewScreen
          >["navigation"]
        }
        route={{
          key: "k",
          name: "TrackCorrectionsReview",
          params: correctionId ? { correctionId } : undefined,
        }}
      />
    </QueryClientProvider>,
  );
};

describe("TrackCorrectionsReviewScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    useAuthStore.setState({
      role: "ADMIN",
      roles: ["ADMIN"],
      isGuest: false,
    });
    api.list.mockResolvedValue(page([correction()]));
    api.approve.mockResolvedValue(correction({ status: "APPROVED" }));
    api.reject.mockResolvedValue(correction({ status: "REJECTED" }));
  });

  afterAll(() => {
    useAuthStore.setState({ role: null, isGuest: false });
  });

  it("charge les propositions en attente et affiche le diff", async () => {
    const { findByText, getByText } = await renderScreen();

    expect(await findByText("España Cañí")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith({
      status: "PENDING",
      skip: 0,
      take: 20,
    });
    expect(getByText("60")).toBeTruthy();
    expect(getByText("62")).toBeTruthy();
    expect(getByText("Compté au métronome")).toBeTruthy();
    expect(getByText(/Eva Martin/)).toBeTruthy();
  });

  it("valide avec ajustement et commentaire après confirmation", async () => {
    const alert = confirmWith("Valider");
    const { findByTestId, getByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId("correction-adjust-c1"));
    await fireEvent.changeText(getByTestId("correction-edit-bpm-c1"), "61");
    await fireEvent.changeText(
      getByTestId("correction-comment-c1"),
      " Merci ! ",
    );
    await fireEvent.press(getByTestId("correction-approve-c1"));

    await waitFor(() =>
      expect(api.approve).toHaveBeenCalledWith("c1", {
        bpm: 61,
        comment: "Merci !",
      }),
    );
    expect(alert).toHaveBeenCalledWith(
      "Proposition validée",
      expect.any(String),
    );
  });

  it("valide sans ajustement : corps vide", async () => {
    confirmWith("Valider");
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId("correction-approve-c1"));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith("c1", {}));
  });

  it("bloque un ajustement invalide", async () => {
    const alert = confirmWith("Valider");
    const { findByTestId, getByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId("correction-adjust-c1"));
    await fireEvent.changeText(getByTestId("correction-edit-bpm-c1"), "0");
    await fireEvent.press(getByTestId("correction-approve-c1"));

    expect(api.approve).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      "Valeurs invalides",
      expect.stringContaining("MPM"),
    );
  });

  it("refuse avec commentaire après confirmation", async () => {
    confirmWith("Refuser");
    const { findByTestId, getByTestId } = await renderScreen();
    await fireEvent.changeText(
      await findByTestId("correction-comment-c1"),
      "Le MPM est correct",
    );
    await fireEvent.press(getByTestId("correction-reject-c1"));

    await waitFor(() =>
      expect(api.reject).toHaveBeenCalledWith("c1", "Le MPM est correct"),
    );
  });

  it("n'appelle rien si l'admin annule la confirmation", async () => {
    confirmWith("Annuler");
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId("correction-reject-c1"));
    expect(api.reject).not.toHaveBeenCalled();
  });

  it("409 : prévient que la proposition est déjà traitée et rafraîchit", async () => {
    const alert = confirmWith("Valider");
    api.approve.mockRejectedValueOnce(
      new TrackCorrectionApiError("Cette proposition a déjà été traitée.", 409),
    );
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId("correction-approve-c1"));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Déjà traitée",
        expect.stringContaining("déjà été traitée"),
      ),
    );
    // Invalidation → la liste est rechargée.
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("filtre par statut et affiche la décision passée", async () => {
    api.list.mockImplementation(({ status }: { status: string }) =>
      Promise.resolve(
        page(
          status === "REJECTED"
            ? [
                correction({
                  id: "c9",
                  status: "REJECTED",
                  reviewer: { id: "a1", name: "Admin Un" },
                  reviewComment: "Doublon",
                  reviewedAt: "2026-10-07T10:00:00Z",
                }),
              ]
            : [],
        ),
      ),
    );
    const { findByText, getByTestId, findByTestId, queryByTestId } =
      await renderScreen();

    expect(await findByTestId("corrections-empty")).toBeTruthy();
    await fireEvent.press(getByTestId("corrections-filter-REJECTED"));

    expect(await findByText("Doublon")).toBeTruthy();
    expect(await findByText(/Admin Un/)).toBeTruthy();
    expect(queryByTestId("correction-approve-c9")).toBeNull();
  });

  it("met en tête la proposition ouverte depuis une notification", async () => {
    api.list.mockResolvedValue(
      page([correction({ id: "c1" }), correction({ id: "c2" })]),
    );
    const { findAllByTestId } = await renderScreen("c2");
    const cards = await findAllByTestId(/^correction-card-/);
    expect(cards[0].props.testID).toBe("correction-card-c2");
  });

  it("refuse l'accès à un non-admin sans appeler l'API", async () => {
    useAuthStore.setState({ role: "LICENSEE", roles: ["LICENSEE"] });
    const { findByText } = await renderScreen();
    expect(await findByText("Accès réservé aux administrateurs.")).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("propose de réessayer si le chargement échoue", async () => {
    api.list.mockRejectedValueOnce(new Error("down"));
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId("corrections-retry"));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  describe("revue des correctifs", () => {
    const pasoClash = correction({
      reason: "PASO_CLASH",
      proposed: {
        title: null,
        artist: null,
        style: null,
        bpm: null,
        clashTimecodes: [45.5, 90.3],
      },
      resultingBpm: 60,
    });

    it("pré-remplit les clashs en m:ss.d et ne les renvoie pas s'ils sont inchangés", async () => {
      confirmWith("Valider");
      api.list.mockResolvedValue(page([pasoClash]));
      const { findByTestId, getByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-adjust-c1"));
      expect(getByTestId("correction-edit-clashes-c1").props.value).toBe(
        "0:45.5, 1:30.3",
      );
      await fireEvent.press(getByTestId("correction-approve-c1"));
      await waitFor(() => expect(api.approve).toHaveBeenCalledWith("c1", {}));
    });

    it("renvoie les clashs, avec leurs dixièmes, quand l'admin les modifie", async () => {
      confirmWith("Valider");
      api.list.mockResolvedValue(page([pasoClash]));
      const { findByTestId, getByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-adjust-c1"));
      await fireEvent.changeText(
        getByTestId("correction-edit-clashes-c1"),
        "0:45.5, 1:31.2",
      );
      await fireEvent.press(getByTestId("correction-approve-c1"));
      await waitFor(() =>
        expect(api.approve).toHaveBeenCalledWith("c1", {
          clashTimecodes: [45.5, 91.2],
        }),
      );
    });

    const danceOnly = correction({
      reason: "DANCE",
      proposed: {
        title: null,
        artist: null,
        style: "Samba",
        bpm: null,
        clashTimecodes: null,
      },
      resultingBpm: 50,
    });

    it("changement de danse seul : affiche le MPM recalculé", async () => {
      api.list.mockResolvedValue(page([danceOnly]));
      const { findByText, getByText } = await renderScreen();
      expect(await findByText("MPM recalculé")).toBeTruthy();
      expect(getByText("50")).toBeTruthy();
    });

    it("« Garder le MPM actuel » envoie bpm: track.bpm", async () => {
      confirmWith("Valider");
      api.list.mockResolvedValue(page([danceOnly]));
      const { findByTestId, getByTestId } = await renderScreen();

      await fireEvent(
        await findByTestId("correction-keep-bpm-c1"),
        "onValueChange",
        true,
      );
      await fireEvent.press(getByTestId("correction-approve-c1"));
      await waitFor(() =>
        expect(api.approve).toHaveBeenCalledWith("c1", { bpm: 60 }),
      );
    });

    it("sans la bascule, laisse le backend recalculer (pas de bpm)", async () => {
      confirmWith("Valider");
      api.list.mockResolvedValue(page([danceOnly]));
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId("correction-approve-c1"));
      await waitFor(() => expect(api.approve).toHaveBeenCalledWith("c1", {}));
    });

    it("pas de bascule quand un MPM est proposé", async () => {
      const { findByTestId, queryByTestId } = await renderScreen();
      await findByTestId("correction-card-c1");
      expect(queryByTestId("correction-keep-bpm-c1")).toBeNull();
    });
  });

  describe("pagination et proposition ciblée", () => {
    it("charge la page suivante en fin de liste", async () => {
      api.list.mockImplementation(({ skip }: { skip: number }) =>
        Promise.resolve({
          data: [correction({ id: `c-${skip}` })],
          meta: { total: 21, skip, take: 20, hasMore: skip === 0 },
        }),
      );
      const { findByTestId, getByTestId } = await renderScreen();
      await findByTestId("correction-card-c-0");

      await fireEvent(getByTestId("corrections-list"), "onEndReached");

      expect(await findByTestId("correction-card-c-20")).toBeTruthy();
      expect(api.list).toHaveBeenLastCalledWith({
        status: "PENDING",
        skip: 20,
        take: 20,
      });
      // Plus rien à charger : un nouveau bout de liste n'appelle plus l'API.
      await fireEvent(getByTestId("corrections-list"), "onEndReached");
      expect(api.list).toHaveBeenCalledTimes(2);
    });

    it("va chercher dans les autres statuts la proposition absente de la file", async () => {
      api.list.mockImplementation(
        ({ status, take }: { status: string; take: number }) =>
          Promise.resolve(
            page(
              status === "REJECTED" && take === 100
                ? [correction({ id: "c-old", status: "REJECTED" })]
                : status === "PENDING" && take === 20
                  ? [correction({ id: "c1" })]
                  : [],
            ),
          ),
      );
      const { findByTestId, getAllByTestId } = await renderScreen("c-old");

      expect(await findByTestId("correction-card-c-old")).toBeTruthy();
      const cards = getAllByTestId(/^correction-card-/);
      expect(cards[0].props.testID).toBe("correction-card-c-old");
      expect(api.list).toHaveBeenCalledWith({ status: "APPROVED", take: 100 });
      expect(api.list).toHaveBeenCalledWith({ status: "REJECTED", take: 100 });
    });

    it("ne cherche pas ailleurs quand la proposition est déjà affichée", async () => {
      const { findByTestId } = await renderScreen("c1");
      await findByTestId("correction-card-c1");
      expect(api.list).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Bug beta : après validation, la proposition restait dans « En attente »
   * jusqu'à quitter puis rouvrir l'écran.
   */
  describe("retrait de la file après décision", () => {
    /** File « En attente » figée : simule un rechargement lent ou en retard. */
    const stalePendingList = () =>
      api.list.mockImplementation(({ status }: { status: string }) =>
        Promise.resolve(
          page(
            status === "PENDING"
              ? [correction({ id: "c1" }), correction({ id: "c2" })]
              : [],
          ),
        ),
      );

    it("retire immédiatement la proposition validée de la file", async () => {
      confirmWith("Valider");
      stalePendingList();
      const { findByTestId, queryByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-approve-c1"));

      await waitFor(() =>
        expect(queryByTestId("correction-card-c1")).toBeNull(),
      );
      expect(queryByTestId("correction-card-c2")).toBeTruthy();
      // La file est tout de même rechargée (état serveur).
      await waitFor(() =>
        expect(
          api.list.mock.calls.filter(
            ([q]: [{ status: string }]) => q.status === "PENDING",
          ).length,
        ).toBeGreaterThanOrEqual(2),
      );
    });

    it("retire aussi une proposition refusée", async () => {
      confirmWith("Refuser");
      stalePendingList();
      const { findByTestId, queryByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-reject-c2"));

      await waitFor(() =>
        expect(queryByTestId("correction-card-c2")).toBeNull(),
      );
      expect(queryByTestId("correction-card-c1")).toBeTruthy();
    });

    it("ouverte depuis une notification : ne revient pas en tête une fois validée", async () => {
      confirmWith("Valider");
      // Après validation, le serveur ne la sert plus en attente, mais le
      // repli « proposition ciblée » la retrouve parmi les validées.
      let approved = false;
      api.approve.mockImplementation(() => {
        approved = true;
        return Promise.resolve(correction({ id: "c2", status: "APPROVED" }));
      });
      api.list.mockImplementation(({ status }: { status: string }) =>
        Promise.resolve(
          page(
            status === "PENDING"
              ? approved
                ? [correction({ id: "c1" })]
                : [correction({ id: "c1" }), correction({ id: "c2" })]
              : status === "APPROVED" && approved
                ? [correction({ id: "c2", status: "APPROVED" })]
                : [],
          ),
        ),
      );
      const { findByTestId, queryByTestId } = await renderScreen("c2");

      await fireEvent.press(await findByTestId("correction-approve-c2"));

      await waitFor(() =>
        expect(queryByTestId("correction-card-c2")).toBeNull(),
      );
      // Laisse le repli éventuel se résoudre : elle ne doit pas réapparaître.
      await waitFor(() =>
        expect(api.list).toHaveBeenCalledWith({
          status: "APPROVED",
          take: 100,
        }),
      );
      expect(queryByTestId("correction-card-c2")).toBeNull();
      expect(queryByTestId("correction-card-c1")).toBeTruthy();
    });

    it("409 : retire aussi la proposition déjà traitée par un autre admin", async () => {
      confirmWith("Valider");
      stalePendingList();
      api.approve.mockRejectedValueOnce(
        new TrackCorrectionApiError(
          "Cette proposition a déjà été traitée.",
          409,
        ),
      );
      const { findByTestId, queryByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-approve-c1"));

      await waitFor(() =>
        expect(queryByTestId("correction-card-c1")).toBeNull(),
      );
    });

    it("reste visible dans l'onglet « Validées »", async () => {
      confirmWith("Valider");
      api.list.mockImplementation(({ status }: { status: string }) =>
        Promise.resolve(
          page(
            status === "APPROVED"
              ? [correction({ id: "c1", status: "APPROVED" })]
              : [correction({ id: "c1" })],
          ),
        ),
      );
      const { findByTestId, queryByTestId, getByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-approve-c1"));
      await waitFor(() =>
        expect(queryByTestId("correction-card-c1")).toBeNull(),
      );

      await fireEvent.press(getByTestId("corrections-filter-APPROVED"));
      expect(await findByTestId("correction-card-c1")).toBeTruthy();
    });
  });

  describe("bibliothèque", () => {
    it("une validation signale la bibliothèque comme périmée", async () => {
      confirmWith("Valider");
      const before = useLibrarySyncStore.getState().version;
      const { findByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-approve-c1"));

      await waitFor(() =>
        expect(useLibrarySyncStore.getState().version).toBe(before + 1),
      );
    });

    it("un refus ne touche pas à la bibliothèque", async () => {
      confirmWith("Refuser");
      const before = useLibrarySyncStore.getState().version;
      const { findByTestId } = await renderScreen();

      await fireEvent.press(await findByTestId("correction-reject-c1"));

      await waitFor(() => expect(api.reject).toHaveBeenCalled());
      expect(useLibrarySyncStore.getState().version).toBe(before);
    });
  });
});
