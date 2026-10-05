import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { BackendService } from "../../../../services/BackendService";
import { AddTrackModal } from "../AddTrackModal";
import { mpmFromBpm } from "../../utils/danceTempo";

jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    updateTrack: jest.fn().mockResolvedValue(undefined),
    deleteTrack: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../context/LibraryContext", () => ({
  useLibrary: () => ({
    reloadLibrary: jest.fn(),
  }),
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

const editTrack = {
  id: "track-1",
  title: "Song",
  artist: "Artist",
  bpm: 120,
  rawBpm: 120,
  style: "Tango",
  filename: "song.mp3",
};

describe("AddTrackModal (edit-only)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  });

  it("prefills the form from the edited track", async () => {
    const { getByTestId } = await render(
      <AddTrackModal visible onClose={jest.fn()} editTrack={editTrack} />,
    );

    expect(getByTestId("add-track-title-input").props.value).toBe("Song");
    expect(getByTestId("add-track-artist-input").props.value).toBe("Artist");
    expect(getByTestId("add-track-bpm-input").props.value).toBe("120");
  });

  it("does not render the mask/blacklist moderation switches", async () => {
    const { queryByTestId } = await render(
      <AddTrackModal visible onClose={jest.fn()} editTrack={editTrack} />,
    );

    expect(queryByTestId("add-track-mask-title-switch")).toBeNull();
    expect(queryByTestId("add-track-blacklist-switch")).toBeNull();
  });

  it("saves edited metadata (title) via updateTrack", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <AddTrackModal visible onClose={onClose} editTrack={editTrack} />,
    );

    await fireEvent.changeText(
      getByTestId("add-track-title-input"),
      "New Title",
    );
    await fireEvent.press(getByTestId("add-track-save-button"));

    await waitFor(() => {
      expect(BackendService.updateTrack).toHaveBeenCalledWith(
        "track-1",
        expect.objectContaining({ title: "New Title" }),
      );
    });
  });

  it("recomputes the MPM when the dance changes (BPM→MPM kept)", async () => {
    const { getByTestId, getByText } = await render(
      <AddTrackModal visible onClose={jest.fn()} editTrack={editTrack} />,
    );

    // Switch to Jive → the MPM field updates to the dance-aware value.
    await fireEvent.press(getByText("Jive"));

    expect(getByTestId("add-track-bpm-input").props.value).toBe(
      String(mpmFromBpm(120, "Jive")),
    );
  });

  it("deletes the track after confirming the destructive alert", async () => {
    (Alert.alert as jest.Mock).mockImplementation(
      (
        _title: string,
        _msg: string,
        buttons?: { text: string; onPress?: () => void }[],
      ) => {
        buttons?.find((b) => b.text === "Supprimer")?.onPress?.();
      },
    );

    const onClose = jest.fn();
    const { getByTestId } = await render(
      <AddTrackModal visible onClose={onClose} editTrack={editTrack} />,
    );

    await fireEvent.press(getByTestId("add-track-delete-button"));

    await waitFor(() => {
      expect(BackendService.deleteTrack).toHaveBeenCalledWith("track-1");
    });
  });
});
