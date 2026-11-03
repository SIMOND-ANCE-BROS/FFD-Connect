/** Acceptation CGU (#424), par compte (#894). */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CguAcceptanceModal } from "../CguAcceptanceModal";
import { CGU_VERSION } from "../cguConsent";
import { currentCguSubject } from "../cguSubject";
import { CguApi } from "../../../services/api/cgu-api";
import { preloadReactNative } from "../../../__tests__/mocks/preloadReactNative";

jest.mock("../cguSubject", () => ({ currentCguSubject: jest.fn() }));
jest.mock("../../../services/api/cgu-api", () => ({
  CguApi: { hasAccepted: jest.fn(), accept: jest.fn() },
}));

const subject = currentCguSubject as jest.Mock;
const hasAccepted = CguApi.hasAccepted as jest.Mock;
const accept = CguApi.accept as jest.Mock;

jest.mock("../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      primary: "#007AFF",
    },
  }),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  subject.mockResolvedValue({ kind: "guest" });
  hasAccepted.mockResolvedValue(null);
  accept.mockResolvedValue(true);
});

const Gate = (props: { active?: boolean; isGuest?: boolean }) => (
  <CguAcceptanceModal
    active={props.active ?? true}
    isGuest={props.isGuest ?? true}
  />
);

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("Modal");

describe("CguAcceptanceModal", () => {
  it("s'affiche au premier lancement (CGU non acceptées)", async () => {
    const { findByTestId } = await render(<Gate />);
    expect(await findByTestId("cgu-accept-button")).toBeTruthy();
  });

  it("ne rend rien si les CGU sont déjà acceptées", async () => {
    await AsyncStorage.setItem("cgu_accepted_version", CGU_VERSION);

    const { queryByTestId } = await render(<Gate />);
    await act(async () => {});

    expect(queryByTestId("cgu-accept-button")).toBeNull();
  });

  it("accepter ferme la modale et persiste le consentement", async () => {
    const { findByTestId, queryByTestId } = await render(<Gate />);

    await fireEvent.press(await findByTestId("cgu-accept-button"));

    await waitFor(async () => {
      expect(queryByTestId("cgu-accept-button")).toBeNull();
      expect(await AsyncStorage.getItem("cgu_accepted_version")).toBe(
        CGU_VERSION,
      );
    });
  });

  it("lecteur d'écran (#22) : titre et sections en intitulés, bouton nommé", async () => {
    const { findByRole, getAllByRole } = await render(<Gate />);
    expect(
      await findByRole("header", {
        name: "Conditions générales d'utilisation",
      }),
    ).toBeTruthy();
    expect(getAllByRole("header").length).toBeGreaterThan(1);
    const accept = await findByRole("button", {
      name: "Accepter les conditions générales d'utilisation",
    });
    expect(accept.props.testID).toBe("cgu-accept-button");
  });

  describe("par compte (#894)", () => {
    const alice = { kind: "account", id: "alice" };

    it("un nouveau compte sur un appareil déjà utilisé doit accepter", async () => {
      // L'appareil a déjà accepté (invité, ou version d'avant #894).
      await AsyncStorage.setItem("cgu_accepted_version", CGU_VERSION);
      subject.mockResolvedValue(alice);
      hasAccepted.mockResolvedValue(false);

      const { findByTestId } = await render(<Gate isGuest={false} />);
      expect(await findByTestId("cgu-accept-button")).toBeTruthy();
    });

    it("ne rend rien si le compte a déjà accepté (autre appareil)", async () => {
      subject.mockResolvedValue(alice);
      hasAccepted.mockResolvedValue(true);

      const { queryByTestId } = await render(<Gate isGuest={false} />);
      await act(async () => {});
      expect(queryByTestId("cgu-accept-button")).toBeNull();
    });

    it("accepter enregistre sur le compte", async () => {
      subject.mockResolvedValue(alice);
      hasAccepted.mockResolvedValue(false);

      const { findByTestId, queryByTestId } = await render(
        <Gate isGuest={false} />,
      );
      await fireEvent.press(await findByTestId("cgu-accept-button"));

      await waitFor(() => {
        expect(queryByTestId("cgu-accept-button")).toBeNull();
        expect(accept).toHaveBeenCalledWith(CGU_VERSION);
      });
    });

    it("hors session ou en accès support : rien n'est demandé", async () => {
      const { queryByTestId } = await render(<Gate active={false} />);
      await act(async () => {});
      expect(queryByTestId("cgu-accept-button")).toBeNull();
      expect(subject).not.toHaveBeenCalled();
    });

    it("aucune identité lisible : rien n'est demandé", async () => {
      subject.mockResolvedValue(null);
      const { queryByTestId } = await render(<Gate isGuest={false} />);
      await act(async () => {});
      expect(queryByTestId("cgu-accept-button")).toBeNull();
    });

    it("une session qui se termine pendant la vérification n'affiche rien", async () => {
      let resolve: (v: boolean) => void = () => {};
      subject.mockResolvedValue(alice);
      hasAccepted.mockReturnValue(
        new Promise<boolean>((r) => {
          resolve = r;
        }),
      );
      const view = await render(<Gate isGuest={false} />);
      await view.rerender(<Gate active={false} isGuest={false} />);
      await act(async () => {
        resolve(false);
      });
      expect(view.queryByTestId("cgu-accept-button")).toBeNull();
    });
  });
});
