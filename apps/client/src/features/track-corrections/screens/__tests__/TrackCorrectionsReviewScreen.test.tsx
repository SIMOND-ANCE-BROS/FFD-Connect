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
  },
  proposer: { id: "u1", name: "Eva Martin" },
  reviewer: null,
  ...overrides,
});

const page = (data: TrackCorrectionAdminDto[]) => ({
  data,
  meta: { total: data.length, skip: 0, take: 50, hasMore: false },
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
    useAuthStore.setState({ role: "ADMIN", isGuest: false });
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
    expect(api.list).toHaveBeenCalledWith({ status: "PENDING", take: 50 });
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
    useAuthStore.setState({ role: "LICENSEE" });
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
});
