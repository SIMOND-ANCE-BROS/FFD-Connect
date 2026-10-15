import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { AddTrackModal } from "../AddTrackModal";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Screen-reader contract of the track editor modal (RGAA, issue #22).

jest.mock("../../../../services/BackendService", () => ({
  BackendService: {
    updateTrack: jest.fn().mockResolvedValue(undefined),
    deleteTrack: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../context/LibraryContext", () => ({
  useLibrary: () => ({ reloadLibrary: jest.fn() }),
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

preloadReactNative("Modal", "Animated", "TextInput");

const editTrack = {
  id: "track-1",
  title: "Song",
  artist: "Artist",
  bpm: 120,
  rawBpm: 120,
  style: "Tango",
  filename: "song.mp3",
};

describe("AddTrackModal accessibility", () => {
  it("exposes the title as a heading and names the close button", async () => {
    const onClose = jest.fn();
    const { getByRole } = await render(
      <AddTrackModal visible onClose={onClose} editTrack={editTrack} />,
    );
    expect(getByRole("header", { name: "Modifier la musique" })).toBeTruthy();
    await fireEvent.press(getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names the fields once (visual captions hidden)", async () => {
    const { getByLabelText, queryByText } = await render(
      <AddTrackModal visible onClose={jest.fn()} editTrack={editTrack} />,
    );
    expect(getByLabelText("Titre de la musique").props.testID).toBe(
      "add-track-title-input",
    );
    expect(getByLabelText("Nom de l'artiste").props.testID).toBe(
      "add-track-artist-input",
    );
    expect(queryByText("MPM (mesures/min)")).toBeNull();
  });

  it("reports the selected dance", async () => {
    const { getByRole } = await render(
      <AddTrackModal visible onClose={jest.fn()} editTrack={editTrack} />,
    );
    expect(
      getByRole("button", { name: "Tango" }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    await fireEvent.press(getByRole("button", { name: "Jive" }));
    expect(
      getByRole("button", { name: "Jive" }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      getByRole("button", { name: "Tango" }).props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it("names the save and delete buttons", async () => {
    const { getByRole } = await render(
      <AddTrackModal visible onClose={jest.fn()} editTrack={editTrack} />,
    );
    expect(
      getByRole("button", { name: "Enregistrer les modifications" }).props
        .testID,
    ).toBe("add-track-save-button");
    expect(
      getByRole("button", { name: "Supprimer la musique" }).props.testID,
    ).toBe("add-track-delete-button");
  });
});
