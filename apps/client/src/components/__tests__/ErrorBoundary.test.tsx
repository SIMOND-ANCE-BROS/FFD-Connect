import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { ReportService } from "../../features/competitions/services/ReportService";
import { ErrorBoundary } from "../ErrorBoundary";

jest.mock("../../features/competitions/services/ReportService", () => ({
  ReportService: {
    sendReport: jest.fn(),
  },
}));

describe("ErrorBoundary", () => {
  const consoleErrorSpy = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders fallback UI when a child throws", async () => {
    const Thrower = () => {
      throw new Error("Boom");
    };

    const { getByText } = await render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );

    expect(getByText("Oups !")).toBeTruthy();
    expect(getByText("Une erreur est survenue.")).toBeTruthy();
  });

  it("sends report when user taps report button", async () => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const Thrower = () => {
      throw new Error("Crash");
    };

    const { getByText } = await render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );

    await fireEvent.press(getByText("Signaler au développeur"));

    await waitFor(() => {
      expect(ReportService.sendReport).toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalled();
    });
  });
});
