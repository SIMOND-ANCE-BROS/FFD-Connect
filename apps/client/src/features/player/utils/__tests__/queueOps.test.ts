import { TrackData } from "../../types";
import {
  appendTrack,
  insertNext,
  moveTrack,
  queueFeedbackMessage,
  removeTrackById,
} from "../queueOps";

const t = (id: string): TrackData => ({
  id,
  url: `https://cdn/${id}.mp3`,
  title: `Title ${id}`,
  artist: "Artist",
  baseBpm: 120,
});

const ids = (queue: TrackData[]) => queue.map((track) => track.id);

describe("queueOps", () => {
  const queue = [t("a"), t("b"), t("c"), t("d")];

  describe("insertNext", () => {
    it("inserts right after the current track", () => {
      expect(ids(insertNext(queue, t("x"), "b"))).toEqual([
        "a",
        "b",
        "x",
        "c",
        "d",
      ]);
    });

    it("inserts after the last track when it is the current one", () => {
      expect(ids(insertNext(queue, t("x"), "d"))).toEqual([
        "a",
        "b",
        "c",
        "d",
        "x",
      ]);
    });

    it("inserts first without a current track", () => {
      expect(ids(insertNext(queue, t("x"), null))).toEqual([
        "x",
        "a",
        "b",
        "c",
        "d",
      ]);
      expect(ids(insertNext([], t("x"), null))).toEqual(["x"]);
    });

    it("inserts first when the current track is not in the queue", () => {
      expect(ids(insertNext(queue, t("x"), "zz"))[0]).toBe("x");
    });

    it("moves an already-queued track instead of duplicating it", () => {
      expect(ids(insertNext(queue, t("d"), "a"))).toEqual(["a", "d", "b", "c"]);
      // Earlier in the queue than the current track: still lands after it.
      expect(ids(insertNext(queue, t("a"), "c"))).toEqual(["b", "c", "a", "d"]);
    });

    it("leaves the queue untouched for the current track", () => {
      expect(insertNext(queue, t("b"), "b")).toBe(queue);
    });

    it("does not mutate its input", () => {
      const copy = [...queue];
      insertNext(queue, t("x"), "a");
      expect(queue).toEqual(copy);
    });
  });

  describe("appendTrack", () => {
    it("appends at the end", () => {
      expect(ids(appendTrack(queue, t("x"), "a"))).toEqual([
        "a",
        "b",
        "c",
        "d",
        "x",
      ]);
    });

    it("moves an already-queued track to the end", () => {
      expect(ids(appendTrack(queue, t("b"), "a"))).toEqual([
        "a",
        "c",
        "d",
        "b",
      ]);
    });

    it("leaves the queue untouched for the current track", () => {
      expect(appendTrack(queue, t("a"), "a")).toBe(queue);
    });

    it("works on an empty queue", () => {
      expect(ids(appendTrack([], t("x"), null))).toEqual(["x"]);
    });
  });

  describe("moveTrack", () => {
    it("moves a track down", () => {
      expect(ids(moveTrack(queue, 0, 2))).toEqual(["b", "c", "a", "d"]);
    });

    it("moves a track up", () => {
      expect(ids(moveTrack(queue, 3, 1))).toEqual(["a", "d", "b", "c"]);
    });

    it.each([
      [1, 1],
      [-1, 2],
      [0, 4],
      [4, 0],
      [0.5, 1],
    ])(
      "returns the same queue for a no-op or invalid move (%p → %p)",
      (from, to) => {
        expect(moveTrack(queue, from, to)).toBe(queue);
      },
    );
  });

  describe("removeTrackById", () => {
    it("removes the track", () => {
      expect(ids(removeTrackById(queue, "c"))).toEqual(["a", "b", "d"]);
    });

    it("returns the same queue when the track is absent", () => {
      expect(removeTrackById(queue, "zz")).toBe(queue);
    });
  });

  describe("queueFeedbackMessage", () => {
    it.each([
      ["started", "next", "Lecture de « Rumba »"],
      ["queued", "next", "« Rumba » sera lu ensuite"],
      ["queued", "end", "« Rumba » ajouté à la file d'attente"],
      ["unchanged", "end", "« Rumba » est déjà en lecture"],
      ["failed", "next", "Impossible de lire « Rumba »"],
    ] as const)("%s / %s", (result, kind, expected) => {
      expect(queueFeedbackMessage(result, kind, "Rumba")).toBe(expected);
    });
  });
});
