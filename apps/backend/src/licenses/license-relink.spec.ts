import { LicenceLinkWriter, linkUnclaimedLicence } from "./license-relink";

describe("linkUnclaimedLicence (#881)", () => {
  const writer = (linked = 1) => {
    const tx = {
      license: { updateMany: jest.fn().mockResolvedValue({ count: linked }) },
      retiredLicenseNumber: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    return { tx, client: tx as unknown as LicenceLinkWriter };
  };

  it("links the licence under a fresh id, only while it is unclaimed", async () => {
    const { tx, client } = writer();

    const newId = await linkUnclaimedLicence(client, "lic-old", "user-1");

    expect(newId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(tx.license.updateMany).toHaveBeenCalledWith({
      where: { id: "lic-old", userId: null },
      data: { id: newId, userId: "user-1" },
    });
    // The numbers the licence carried before follow it.
    expect(tx.retiredLicenseNumber.updateMany).toHaveBeenCalledWith({
      where: { licenseId: "lic-old" },
      data: { licenseId: newId },
    });
  });

  it("draws a different id on every link", async () => {
    const { client } = writer();
    const first = await linkUnclaimedLicence(client, "lic-old", "user-1");
    const second = await linkUnclaimedLicence(client, "lic-old", "user-2");
    expect(first).not.toBe(second);
  });

  it("returns null and moves nothing when the licence is already linked", async () => {
    const { tx, client } = writer(0);

    await expect(
      linkUnclaimedLicence(client, "lic-old", "user-1"),
    ).resolves.toBeNull();
    expect(tx.retiredLicenseNumber.updateMany).not.toHaveBeenCalled();
  });
});
