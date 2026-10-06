import {
  MASKED_TITLE_LABEL,
  publicTrackName,
  REMOVED_TRACK_LABEL,
} from "./track-visibility.util";

describe("publicTrackName", () => {
  const track = {
    title: "Vrai titre",
    artist: "Artiste",
    titleMasked: false,
    blacklisted: false,
  };

  it("renvoie le nom réel d'une piste non modérée", () => {
    expect(publicTrackName(track)).toEqual({
      title: "Vrai titre",
      artist: "Artiste",
    });
  });

  it("remplace le titre masqué par le libellé neutre, garde l'artiste", () => {
    expect(publicTrackName({ ...track, titleMasked: true })).toEqual({
      title: MASKED_TITLE_LABEL,
      artist: "Artiste",
    });
  });

  it("ne révèle ni titre ni artiste d'une piste blacklistée (même masquée)", () => {
    expect(
      publicTrackName({ ...track, blacklisted: true, titleMasked: true }),
    ).toEqual({ title: REMOVED_TRACK_LABEL, artist: "" });
  });
});
