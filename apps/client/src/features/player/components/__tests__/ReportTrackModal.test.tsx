import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { BackendService } from "../../../../services/BackendService";
import { ReportTrackModal } from "../ReportTrackModal";

jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    reportTrack: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      border: "#ddd",
      primary: "#00f",
    },
    isDark: false,
  }),
}));

const track = { id: "track-1", title: "My Song" };

describe("ReportTrackModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  });

  it("renders the track title and every reason once the dropdown is open", async () => {
    const { getByText, getByTestId } = await render(
      <ReportTrackModal visible onClose={jest.fn()} track={track} />,
    );

    expect(getByText("My Song")).toBeTruthy();
    // Motifs cachés tant que la liste déroulante est fermée → on l'ouvre.
    await fireEvent.press(getByTestId("report-reason-dropdown"));
    expect(getByTestId("report-reason-TITLE")).toBeTruthy();
    expect(getByTestId("report-reason-ARTIST")).toBeTruthy();
    expect(getByTestId("report-reason-DANCE")).toBeTruthy();
    expect(getByTestId("report-reason-MPM")).toBeTruthy();
    expect(getByTestId("report-reason-PASO_CLASH")).toBeTruthy();
    expect(getByTestId("report-reason-OTHER")).toBeTruthy();
  });

  it("does not call reportTrack until a reason is selected", async () => {
    const { getByTestId } = await render(
      <ReportTrackModal visible onClose={jest.fn()} track={track} />,
    );

    await fireEvent.press(getByTestId("report-submit-button"));

    expect(BackendService.reportTrack).not.toHaveBeenCalled();
  });

  it("submits the selected reason and precisions via reportTrack", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <ReportTrackModal visible onClose={onClose} track={track} />,
    );

    await fireEvent.press(getByTestId("report-reason-dropdown"));
    await fireEvent.press(getByTestId("report-reason-MPM"));
    await fireEvent.changeText(
      getByTestId("report-message-input"),
      "  90 not 120  ",
    );
    await fireEvent.press(getByTestId("report-submit-button"));

    await waitFor(() => {
      expect(BackendService.reportTrack).toHaveBeenCalledWith(
        "track-1",
        "MPM",
        "90 not 120",
      );
    });
    expect(Alert.alert).toHaveBeenCalledWith("Merci", "Signalement envoyé");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("omits the message when left blank", async () => {
    const { getByTestId } = await render(
      <ReportTrackModal visible onClose={jest.fn()} track={track} />,
    );

    await fireEvent.press(getByTestId("report-reason-dropdown"));
    await fireEvent.press(getByTestId("report-reason-OTHER"));
    await fireEvent.press(getByTestId("report-submit-button"));

    await waitFor(() => {
      expect(BackendService.reportTrack).toHaveBeenCalledWith(
        "track-1",
        "OTHER",
        undefined,
      );
    });
  });

  it("shows an error alert and stays open when the request fails", async () => {
    (BackendService.reportTrack as jest.Mock).mockRejectedValueOnce(
      new Error("Network"),
    );
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <ReportTrackModal visible onClose={onClose} track={track} />,
    );

    await fireEvent.press(getByTestId("report-reason-dropdown"));
    await fireEvent.press(getByTestId("report-reason-TITLE"));
    await fireEvent.press(getByTestId("report-submit-button"));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur lors du signalement",
        "Network",
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
