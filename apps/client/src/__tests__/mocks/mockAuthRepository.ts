export const mockAuthRepository = {
  login: jest.fn(),
  loginAsGuest: jest.fn(),
  logout: jest.fn(),
  getAuthConfig: jest.fn().mockResolvedValue({
    role: "LICENSEE",
    hasWdsfLicense: false,
    licensePhotoUri: null,
  }),
  saveAuthConfig: jest.fn().mockResolvedValue(undefined),
  setBiometricsEnabled: jest.fn().mockResolvedValue(undefined),
  setLicensePhoto: jest.fn().mockResolvedValue(undefined),
  setDefaultLibraryFilter: jest.fn().mockResolvedValue(undefined),
  setDefaultCompetitionScope: jest.fn().mockResolvedValue(undefined),
  setDefaultCompetitionStatus: jest.fn().mockResolvedValue(undefined),
  setAppTheme: jest.fn().mockResolvedValue(undefined),
  setAnimationsEnabled: jest.fn().mockResolvedValue(undefined),
  setDancerProfile: jest.fn().mockResolvedValue(undefined),
  setWdsfLicenseEnabled: jest.fn().mockResolvedValue(undefined),
  setRegistrationPolicy: jest.fn().mockResolvedValue(undefined),
  getProfile: jest.fn().mockResolvedValue({}),
  verifyWdsfLicense: jest.fn().mockResolvedValue({}),
  saveWdsfToBackend: jest.fn().mockResolvedValue(undefined),
};

// Prefixed with 'mock' to be allowed in jest.mock factory
export const mockUserRole = {
  LICENSEE: "LICENSEE",
  STAFF: "STAFF",
  GUEST: "GUEST",
  CLUB: "CLUB",
};
