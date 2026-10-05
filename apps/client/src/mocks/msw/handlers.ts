import { http, HttpResponse } from "msw";

// ─── Shared mock data ──────────────────────────────────────────────────────────
// Exported so tests can reference them for assertions.

export const mockUser = {
  id: "user-1",
  email: "test@ffd.com",
  role: "LICENSEE",
  firstName: "Test",
  lastName: "User",
  clubName: "Test Club",
  ageGroup: "Adulte",
  category: "Latin",
};

export const mockLicense = {
  id: "license-1",
  licenseNumber: "FFD-2024-001",
  type: "FFD",
  firstName: "Test",
  lastName: "User",
  validUntil: "2027-08-31",
  club: "Test Club",
};

export const mockCompetition = {
  id: "comp-1",
  title: "Championnat de France",
  date: "2026-06-15",
  location: "Paris",
  status: "UPCOMING",
  events: [
    {
      id: "event-1",
      category: "Latin",
      ageGroup: "Adulte",
      eventType: "COUPLE",
      level: null,
    },
  ],
};

export const mockCareer = {
  partnerships: [
    {
      id: "partnership-1",
      status: "ACTIVE",
      startDate: "2024-01-01",
      endDate: null,
      isCurrent: true,
      partner: {
        id: "user-2",
        firstName: "Partner",
        lastName: "Name",
        clubName: "Test Club",
      },
      clubName: "Test Club",
      secondaryClubName: null,
    },
  ],
  registrations: [
    {
      id: "reg-1",
      status: "CONFIRMED",
      bibNumber: 42,
      partnerName: null,
      event: {
        id: "event-1",
        category: "Latin",
        ageGroup: "Adulte",
        level: null,
      },
      competition: {
        id: "comp-1",
        title: "Championnat de France",
        date: "2026-06-15",
        location: "Paris",
        status: "UPCOMING",
      },
    },
  ],
  results: [
    {
      id: "result-1",
      eventId: "event-1",
      round: "Finale",
      ranking: 1,
      participantLabel: "Test User",
      event: {
        id: "event-1",
        category: "Latin",
        ageGroup: "Adulte",
        level: null,
      },
      competition: {
        id: "comp-1",
        title: "Championnat de France",
        date: "2026-06-15",
        location: "Paris",
        status: "UPCOMING",
      },
    },
  ],
};

export const mockNotifications = [
  {
    id: "notif-1",
    type: "REGISTRATION_CONFIRMED",
    title: "Inscription confirmée",
    message: "Votre inscription a été confirmée.",
    read: false,
    createdAt: "2026-03-01T10:00:00.000Z",
  },
];

export const mockTrack = {
  id: "track-1",
  title: "Test Track",
  artist: "Test Artist",
  duration: 180,
  bpm: 120,
  url: "http://localhost:3000/tracks/track-1/download",
};

export const mockLicenseRenewalRequest = {
  id: "renewal-1",
  userId: "user-1",
  status: "DRAFT",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  documents: [],
};

// ─── Base URL ──────────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost:3000";

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const handlers = [
  // ── Auth ──────────────────────────────────────────────────────────────────

  http.post(`${BASE_URL}/auth/login`, () => {
    return HttpResponse.json({
      access_token: "mock-token",
      refresh_token: "mock-refresh",
      user: mockUser,
    });
  }),

  http.post(`${BASE_URL}/auth/logout`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${BASE_URL}/auth/refresh`, () => {
    return HttpResponse.json({
      access_token: "new-token",
      refresh_token: "new-refresh",
    });
  }),

  http.post(`${BASE_URL}/auth/forgot-password`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${BASE_URL}/auth/reset-password`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.patch(`${BASE_URL}/auth/change-password`, () => {
    return HttpResponse.json({ success: true });
  }),

  // ── Users ─────────────────────────────────────────────────────────────────

  http.get(`${BASE_URL}/users/me`, () => {
    return HttpResponse.json(mockUser);
  }),

  http.patch(`${BASE_URL}/users/me`, async ({ request }) => {
    const body = (await request.json()) as object;
    return HttpResponse.json({ ...mockUser, ...body });
  }),

  // ── Licenses ──────────────────────────────────────────────────────────────

  http.get(`${BASE_URL}/licenses/my`, () => {
    return HttpResponse.json(mockLicense);
  }),

  http.get(`${BASE_URL}/licenses/renewal`, () => {
    return HttpResponse.json(mockLicenseRenewalRequest);
  }),

  http.post(`${BASE_URL}/licenses/renewal`, () => {
    return HttpResponse.json(mockLicenseRenewalRequest);
  }),

  http.post(`${BASE_URL}/licenses/renewal/documents`, () => {
    return HttpResponse.json({
      ...mockLicenseRenewalRequest,
      status: "PENDING",
    });
  }),

  // ── Competitions ──────────────────────────────────────────────────────────

  http.get(`${BASE_URL}/competitions`, () => {
    return HttpResponse.json({
      data: [mockCompetition],
      total: 1,
      page: 1,
      limit: 20,
    });
  }),

  http.get(`${BASE_URL}/competitions/:id`, ({ params }) => {
    return HttpResponse.json({ ...mockCompetition, id: params.id as string });
  }),

  http.get(`${BASE_URL}/competitions/:id/registrants`, () => {
    return HttpResponse.json([]);
  }),

  http.get(`${BASE_URL}/competitions/:id/results`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/competitions/:id/register`, () => {
    return HttpResponse.json({ id: "reg-new", status: "PENDING" });
  }),

  http.delete(`${BASE_URL}/competitions/:id/register`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${BASE_URL}/competitions/:id/checkin`, () => {
    return HttpResponse.json({ registrations: [{ status: "SUCCESS" }] });
  }),

  // ── Career ────────────────────────────────────────────────────────────────

  http.get(`${BASE_URL}/career/me`, () => {
    return HttpResponse.json(mockCareer);
  }),

  http.get(`${BASE_URL}/career/user/:userId`, () => {
    return HttpResponse.json(mockCareer);
  }),

  http.get(`${BASE_URL}/career/search-members`, () => {
    return HttpResponse.json([
      {
        id: "user-2",
        firstName: "Partner",
        lastName: "Name",
        clubName: "Test Club",
      },
    ]);
  }),

  // ── Notifications ─────────────────────────────────────────────────────────

  http.get(`${BASE_URL}/notifications`, () => {
    return HttpResponse.json(mockNotifications);
  }),

  http.patch(`${BASE_URL}/notifications/:id/read`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.patch(`${BASE_URL}/notifications/read-all`, () => {
    return HttpResponse.json({ success: true });
  }),

  // ── Tracks ────────────────────────────────────────────────────────────────

  http.get(`${BASE_URL}/tracks`, () => {
    return HttpResponse.json([mockTrack]);
  }),

  http.get(`${BASE_URL}/tracks/:id`, ({ params }) => {
    return HttpResponse.json({ ...mockTrack, id: params.id as string });
  }),

  http.post(`${BASE_URL}/tracks/analyze`, () => {
    return HttpResponse.json({
      title: "Analyzed Track",
      artist: "Test Artist",
      bpm: 128,
      filename: "test.mp3",
      downloadToken: "mock-token",
    });
  }),

  http.get(`${BASE_URL}/tracks/:id/download`, () => {
    return new HttpResponse(new ArrayBuffer(0), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }),

  // ── Reports ───────────────────────────────────────────────────────────────

  http.post(`${BASE_URL}/reports`, () => {
    return HttpResponse.json({ id: "report-1", status: "SUBMITTED" });
  }),

  // ── TTS ───────────────────────────────────────────────────────────────────

  http.post(`${BASE_URL}/tts`, () => {
    return new HttpResponse(new ArrayBuffer(0), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }),
];
