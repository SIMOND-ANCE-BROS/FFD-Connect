import { fireEvent, render, within } from "@testing-library/react-native";
import React from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { expectSiblingBackdrop } from "../../../../../__tests__/mocks/modalA11y";
import { NO_PARTNER_COPY, PartnerInputModal } from "../PartnerInputModal";
import { preloadReactNative } from "../../../../../__tests__/mocks/preloadReactNative";

// AppText / AppButton read the theme from the context.
jest.mock("../../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      background: "#fafafa",
      text: "#111",
      textSecondary: "#666",
      border: "#ddd",
      primary: "#004481",
    },
    isDark: false,
  }),
}));

const theme = {
  surface: "#fff",
  text: "#111",
  textSecondary: "#666",
  border: "#ddd",
  primary: "#004481",
};

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("Modal", "TextInput");

describe("PartnerInputModal", () => {
  const onClose = jest.fn();
  const onConfirm = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it("a11y (#356): backdrop is a sibling of the card, the field stays reachable", async () => {
    const { getByTestId, getByLabelText, getByText } = await render(
      <PartnerInputModal
        visible
        eventLabel="Adultes C Latines"
        onConfirm={onConfirm}
        onClose={onClose}
        theme={theme}
      />,
    );

    expectSiblingBackdrop(
      getByTestId("partner-input-backdrop"),
      getByTestId("partner-input-card"),
    );

    await fireEvent.changeText(
      getByLabelText("Nom du partenaire"),
      "  Jeanne  ",
    );
    await fireEvent.press(getByText("Valider"));
    expect(onConfirm).toHaveBeenCalledWith("Jeanne");
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("partner-input-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("registered partner (#858)", () => {
    it("explains why a couple event needs a partner and where to add one", async () => {
      const onManagePartner = jest.fn();
      const { getByText, getByTestId, getByLabelText } = await render(
        <PartnerInputModal
          visible
          eventLabel="Adultes C Latines"
          onConfirm={onConfirm}
          onClose={onClose}
          partner={{ status: "none" }}
          onManagePartner={onManagePartner}
          theme={theme}
        />,
      );

      // Cause and action, in words.
      expect(getByText(NO_PARTNER_COPY.TITLE)).toBeTruthy();
      expect(getByText(NO_PARTNER_COPY.MESSAGE)).toBeTruthy();
      const action = getByTestId("partner-input-manage");
      expect(action.props.accessibilityHint).toBe(NO_PARTNER_COPY.ACTION_HINT);
      await fireEvent.press(getByText(NO_PARTNER_COPY.ACTION));
      expect(onManagePartner).toHaveBeenCalledTimes(1);

      // Typing a name stays possible (partner without an account).
      await fireEvent.changeText(getByLabelText("Nom du partenaire"), "Jeanne");
      await fireEvent.press(getByText("Valider"));
      expect(onConfirm).toHaveBeenCalledWith("Jeanne");
    });

    it("pre-fills the registered partner and shows no warning", async () => {
      const { queryByTestId, getByLabelText, getByText } = await render(
        <PartnerInputModal
          visible
          eventLabel="Adultes C Latines"
          onConfirm={onConfirm}
          onClose={onClose}
          partner={{ status: "registered", name: "Jeanne Martin" }}
          onManagePartner={jest.fn()}
          theme={theme}
        />,
      );

      expect(queryByTestId("partner-input-no-partner")).toBeNull();
      expect(getByLabelText("Nom du partenaire").props.value).toBe(
        "Jeanne Martin",
      );
      await fireEvent.press(getByText("Valider"));
      expect(onConfirm).toHaveBeenCalledWith("Jeanne Martin");
    });

    it("pre-fills a partner loaded after opening, never over a typed name", async () => {
      const props = {
        visible: true,
        eventLabel: "Adultes C Latines",
        onConfirm,
        onClose,
        theme,
      };
      const { getByLabelText, rerender } = await render(
        <PartnerInputModal {...props} partner={{ status: "unknown" }} />,
      );
      expect(getByLabelText("Nom du partenaire").props.value).toBe("");

      await rerender(
        <PartnerInputModal
          {...props}
          partner={{ status: "registered", name: "Jeanne Martin" }}
        />,
      );
      expect(getByLabelText("Nom du partenaire").props.value).toBe(
        "Jeanne Martin",
      );
    });

    it("replaces a stale pre-filled partner with the fresh one", async () => {
      // A cached partner (e.g. from another account) is shown first, then
      // the refetch brings the real one: the untouched field must follow.
      const props = {
        visible: true,
        eventLabel: "Adultes C Latines",
        onConfirm,
        onClose,
        theme,
      };
      const { getByLabelText, rerender } = await render(
        <PartnerInputModal
          {...props}
          partner={{ status: "registered", name: "Paul Ancien" }}
        />,
      );
      expect(getByLabelText("Nom du partenaire").props.value).toBe(
        "Paul Ancien",
      );

      await rerender(
        <PartnerInputModal
          {...props}
          partner={{ status: "registered", name: "Jeanne Martin" }}
        />,
      );
      expect(getByLabelText("Nom du partenaire").props.value).toBe(
        "Jeanne Martin",
      );
    });

    it("stops following the partner once the dancer edited the name", async () => {
      const props = {
        visible: true,
        eventLabel: "Adultes C Latines",
        onConfirm,
        onClose,
        theme,
      };
      const { getByLabelText, rerender } = await render(
        <PartnerInputModal
          {...props}
          partner={{ status: "registered", name: "Paul Ancien" }}
        />,
      );
      await fireEvent.changeText(getByLabelText("Nom du partenaire"), "Lucie");
      await rerender(
        <PartnerInputModal
          {...props}
          partner={{ status: "registered", name: "Jeanne Martin" }}
        />,
      );
      expect(getByLabelText("Nom du partenaire").props.value).toBe("Lucie");
    });

    it("keeps a typed name when the partner arrives later", async () => {
      const props = {
        visible: true,
        eventLabel: "Adultes C Latines",
        onConfirm,
        onClose,
        theme,
      };
      const { getByLabelText, rerender } = await render(
        <PartnerInputModal {...props} />,
      );
      await fireEvent.changeText(getByLabelText("Nom du partenaire"), "Paul");
      await rerender(
        <PartnerInputModal
          {...props}
          partner={{ status: "registered", name: "Jeanne Martin" }}
        />,
      );
      expect(getByLabelText("Nom du partenaire").props.value).toBe("Paul");
    });

    it("says nothing about a partner while it is unknown", async () => {
      const { queryByTestId } = await render(
        <PartnerInputModal
          visible
          eventLabel="Adultes C Latines"
          onConfirm={onConfirm}
          onClose={onClose}
          partner={{ status: "unknown" }}
          onManagePartner={jest.fn()}
          theme={theme}
        />,
      );
      expect(queryByTestId("partner-input-no-partner")).toBeNull();
      expect(queryByTestId("partner-input-manage")).toBeNull();
    });
  });

  describe("large text", () => {
    const mockDimensions = (fontScale: number) =>
      jest
        .spyOn(
          jest.requireActual<{
            default: typeof useWindowDimensions;
          }>("react-native/Libraries/Utilities/useWindowDimensions"),
          "default",
        )
        .mockReturnValue({ width: 375, height: 667, scale: 2, fontScale });

    afterEach(() => jest.restoreAllMocks());

    it.each([
      [1, "row"],
      [2, "column"],
    ])(
      "at font scale %d the buttons are laid out in a %s",
      async (fontScale, direction) => {
        mockDimensions(fontScale);
        const { getByTestId, getByText } = await render(
          <PartnerInputModal
            visible
            eventLabel="Adultes C Latines"
            onConfirm={onConfirm}
            onClose={onClose}
            partner={{ status: "none" }}
            onManagePartner={jest.fn()}
            theme={theme}
          />,
        );
        const style = StyleSheet.flatten(
          getByTestId("partner-input-buttons").props.style,
        );
        expect(style.flexDirection).toBe(direction);
        // The whole message stays readable (never truncated).
        expect(
          getByText(NO_PARTNER_COPY.MESSAGE).props.numberOfLines,
        ).toBeUndefined();
      },
    );

    it.each([
      [1, ["Annuler", "Valider"]],
      [2, ["Valider", "Annuler"]],
    ])(
      "at font scale %d screen readers meet the buttons in visual order %j",
      async (fontScale, order) => {
        mockDimensions(fontScale);
        const { getByTestId } = await render(
          <PartnerInputModal
            visible
            eventLabel="Adultes C Latines"
            onConfirm={onConfirm}
            onClose={onClose}
            theme={theme}
          />,
        );
        // Tree order = reading order; no reversed layout to undo it.
        const labels = within(getByTestId("partner-input-buttons"))
          .getAllByRole("button")
          .map((b) => within(b).getByText(/Annuler|Valider/).props.children);
        expect(labels).toEqual(order);
      },
    );
  });
});
