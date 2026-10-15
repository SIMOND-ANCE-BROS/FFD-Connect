import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Event } from "../../context/CompetitionContext";
import { CompetitionEventCard } from "../detail/CompetitionEventCard";

// Screen-reader contract of an event row (RGAA, issue #22): every repeated
// button ("S'inscrire", "Inscrits"…) names the event it acts on.

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666", primary: "#004481" },
    isDark: false,
    animationsEnabled: false,
  }),
}));

const theme = {
  surface: "#fff",
  text: "#000",
  textSecondary: "#666",
  danger: "#c00",
  warning: "#f90",
  primary: "#004481",
} as unknown as AppTheme;

const event = {
  id: "ev-1",
  category: "LATIN",
  ageGroup: "Juniors 2",
  eventType: "COUPLE",
  dance: null,
  level: "C",
} as unknown as Event;

const baseProps = {
  currentTheme: theme,
  event,
  isRegistered: false,
  eligibility: { eligible: true },
  isOrganizer: false,
  canSelfRegister: true,
  showResults: false,
  onNavigateResults: jest.fn(),
  onRegister: jest.fn(),
  onUnregister: jest.fn(),
};

describe("CompetitionEventCard accessibility", () => {
  beforeEach(() => jest.clearAllMocks());

  it("names the register button after the event and keeps its testID", async () => {
    const { getByRole } = await render(
      <CompetitionEventCard {...baseProps} variantLabel="Niveau C" />,
    );
    const register = getByRole("button", {
      name: /^S'inscrire : .*Juniors 2, Niveau C, couple$/,
    });
    expect(register.props.testID).toBe("register-event-ev-1");
    await fireEvent.press(register);
    expect(baseProps.onRegister).toHaveBeenCalledWith(event);

    expect(
      getByRole("button", { name: /^Inscrits : .*Juniors 2/ }),
    ).toBeTruthy();
  });

  it("names the unregister button and says the dancer is registered", async () => {
    const { getByRole, getByLabelText } = await render(
      <CompetitionEventCard {...baseProps} isRegistered />,
    );
    const unregister = getByRole("button", {
      name: /^Se désinscrire : .*Juniors 2/,
    });
    expect(unregister.props.testID).toBe("unregister-event-ev-1");
    expect(getByLabelText(/Juniors 2, couple, inscrit$/)).toBeTruthy();
  });

  it("reads the description and the ineligibility reason as one item", async () => {
    const { getByLabelText } = await render(
      <CompetitionEventCard
        {...baseProps}
        eligibility={{ eligible: false, reason: "WRONG_AGE_GROUP" }}
      />,
    );
    expect(
      getByLabelText(
        /Juniors 2, couple, non éligible, Classe d'âge non compatible$/,
      ),
    ).toBeTruthy();
  });

  it("keeps a plain 'Résultats' button (same target for every row)", async () => {
    const { getByRole } = await render(
      <CompetitionEventCard {...baseProps} showResults />,
    );
    await fireEvent.press(getByRole("button", { name: "Résultats" }));
    expect(baseProps.onNavigateResults).toHaveBeenCalled();
  });

  it("names the organiser's register-members button", async () => {
    const { getByRole } = await render(
      <CompetitionEventCard {...baseProps} isOrganizer />,
    );
    expect(
      getByRole("button", { name: /^Inscrire des membres : .*Juniors 2/ }),
    ).toBeTruthy();
  });
});
