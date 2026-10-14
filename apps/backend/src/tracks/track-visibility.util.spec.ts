import {
  AMBIANCE_TRACK_WHERE,
  NOT_AMBIANCE_TRACK_WHERE,
  publicTrackName,
  REMOVED_TRACK_LABEL,
} from "./track-visibility.util";

describe("publicTrackName", () => {
  const track = {
    title: "Vrai titre",
    artist: "Artiste",
    blacklisted: false,
  };

  it("renvoie le nom réel d'une piste non modérée", () => {
    expect(publicTrackName(track)).toEqual({
      title: "Vrai titre",
      artist: "Artiste",
    });
  });

  it("ignore l'ancien drapeau titleMasked encore présent en base (#560)", () => {
    const legacy = { ...track, titleMasked: true };
    expect(publicTrackName(legacy)).toEqual({
      title: "Vrai titre",
      artist: "Artiste",
    });
  });

  it("ne révèle ni titre ni artiste d'une piste blacklistée", () => {
    expect(publicTrackName({ ...track, blacklisted: true })).toEqual({
      title: REMOVED_TRACK_LABEL,
      artist: "",
    });
  });
});

describe("Ambiance filters of the admin catalogue", () => {
  it("matches the style OR the artist « Ambiance », any case", () => {
    expect(AMBIANCE_TRACK_WHERE).toEqual({
      OR: [
        { style: { equals: "Ambiance", mode: "insensitive" } },
        { artist: { equals: "Ambiance", mode: "insensitive" } },
      ],
    });
  });

  it("keeps the tracks whose style is null when excluding the ambiance", () => {
    expect(NOT_AMBIANCE_TRACK_WHERE).toEqual({
      AND: [
        { artist: { not: { equals: "Ambiance" }, mode: "insensitive" } },
        {
          OR: [
            { style: { not: { equals: "Ambiance" }, mode: "insensitive" } },
            { style: null },
          ],
        },
      ],
    });
  });
});
