import {
  formatLineError,
  formatPreview,
  RESULTS_CSV_COLUMNS,
  reportRows,
} from "../resultsImport";

describe("results import wording (#690)", () => {
  it("formats a line error", () => {
    expect(formatLineError({ line: 3, message: "classement invalide" })).toBe(
      "Ligne 3 : classement invalide",
    );
  });

  it("describes a dry run in plain French, with plurals", () => {
    expect(formatPreview({ created: 12, updated: 3, unchanged: 0 })).toBe(
      "Fichier valide : 12 résultats seront créés, 3 seront mis à jour, 0 est déjà à jour.",
    );
    expect(formatPreview({ created: 1, updated: 1, unchanged: 2 })).toBe(
      "Fichier valide : 1 résultat sera créé, 1 sera mis à jour, 2 sont déjà à jour.",
    );
  });

  it("says when the file holds no result", () => {
    expect(formatPreview({ created: 0, updated: 0, unchanged: 0 })).toBe(
      "Le fichier ne contient aucun résultat à importer.",
    );
  });

  it("lists only the published-content counts of a report", () => {
    expect(reportRows({ created: 4, updated: 2, unchanged: 1 })).toEqual([
      { key: "created", label: "Résultats créés", value: 4 },
      { key: "updated", label: "Résultats mis à jour", value: 2 },
      { key: "unchanged", label: "Résultats inchangés", value: 1 },
    ]);
  });

  it("documents the four required columns first", () => {
    expect(
      RESULTS_CSV_COLUMNS.filter((c) => c.required).map((c) => c.name),
    ).toEqual(["epreuve", "tour", "classement", "couple"]);
  });
});
