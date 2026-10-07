import { AdminReferenceService } from "./admin-reference.service";

describe("AdminReferenceService", () => {
  it("exposes the backend constants", () => {
    const data = new AdminReferenceService().referenceData();
    expect(data.categories).toEqual(["Latin", "Standard", "Ten Dance"]);
    expect(data.ageGroups).toContain("Junior I");
    expect(data.ageGroups).toContain("Solo Adulte");
    expect(data.competitionLevels).toContain("Débutant");
    expect(data.passportLevels[0]).toBe("BLANC");
    expect(data.roles).toEqual(["LICENSEE", "CLUB", "STAFF", "ADMIN"]);
  });
});
