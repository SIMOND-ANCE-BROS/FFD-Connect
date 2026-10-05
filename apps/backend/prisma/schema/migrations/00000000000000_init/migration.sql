-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ClubRegistrationMode" AS ENUM ('CLUB_AND_MEMBERS_PENDING', 'CLUB_ONLY', 'MEMBERS_AUTO_CONFIRM');

-- CreateEnum
CREATE TYPE "PartnershipManagementMode" AS ENUM ('PRIMARY_ONLY', 'SECONDARY_ONLY', 'BOTH');

-- CreateEnum
CREATE TYPE "PartnershipStatus" AS ENUM ('PENDING_SECOND_CLUB', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('PROXIMITE', 'NATIONALE', 'MAJEURE', 'INTERNATIONALE');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('CLASSIFICATRICE', 'OPEN', 'MAJEURE', 'SOLO_TEAM', 'SHOW_DANSE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SOLO', 'COUPLE');

-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('UPCOMING', 'LIVE', 'PAST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LicenseRenewalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LicenseRenewalDocumentType" AS ENUM ('MEDICAL_CERTIFICATE', 'LICENSE_CERTIFICATE');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('PENDING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "PassportLevel" AS ENUM ('BLANC', 'BEIGE', 'JAUNE', 'ORANGE', 'VERT', 'VIOLET', 'BLEU', 'ROUGE', 'NOIR');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LICENSEE', 'CLUB', 'STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "helloAssoClientId" TEXT,
    "helloAssoClientSecret" TEXT,
    "helloAssoOrgSlug" TEXT,
    "registrationMode" "ClubRegistrationMode" NOT NULL DEFAULT 'MEMBERS_AUTO_CONFIRM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partnership" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "secondaryClubId" TEXT,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "status" "PartnershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "managementMode" "PartnershipManagementMode" NOT NULL DEFAULT 'PRIMARY_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloTeam" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoloTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoloTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'UPCOMING',
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ffdId" TEXT,
    "address" TEXT,
    "circularUrl" TEXT,
    "city" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "organizer" TEXT,
    "registrationUrl" TEXT,
    "endDate" TIMESTAMP(3),
    "eventsDescription" TEXT,
    "programUrl" TEXT,
    "type" TEXT,
    "competitionType" "CompetitionType",
    "majorSubType" TEXT,
    "zipCode" TEXT,
    "ticketingUrl" TEXT,
    "layout" JSONB DEFAULT '[]',
    "registrationDeadline" TIMESTAMP(3),

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ageGroup" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL DEFAULT 'COUPLE',
    "level" TEXT,
    "eventKind" "EventKind",

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerName" TEXT,
    "partnerUserId" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "bibNumber" INTEGER,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "checkInTime" TIMESTAMP(3),
    "feePaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coupleAgeGroup" TEXT,
    "coupleDisciplineLatin" BOOLEAN NOT NULL DEFAULT false,
    "coupleDisciplineStandard" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "ranking" INTEGER NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleItem" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatBooking" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "seatLabel" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "userId" TEXT,
    "qrCodeSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseRenewalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LicenseRenewalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseRenewalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseRenewalDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "LicenseRenewalDocumentType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "ocrData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseRenewalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "artwork" TEXT,
    "style" TEXT,
    "bpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawBpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "TrackStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "sourceKey" TEXT,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'LICENSEE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ageGroup" TEXT,
    "category" TEXT,
    "clubId" TEXT,
    "clubName" TEXT,
    "birthDate" TIMESTAMP(3),
    "nationalRanking" INTEGER,
    "passportLevelLatin" "PassportLevel",
    "passportLevelStandard" "PassportLevel",
    "competitionLevel" TEXT,
    "wdsfMin" TEXT,
    "wdsfNationality" TEXT,
    "wdsfLicenseType" TEXT,
    "wdsfAgeGroup" TEXT,
    "wdsfExpiresOn" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Bénévole',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");

-- CreateIndex
CREATE INDEX "Club_name_idx" ON "Club"("name");

-- CreateIndex
CREATE INDEX "Partnership_clubId_idx" ON "Partnership"("clubId");

-- CreateIndex
CREATE INDEX "Partnership_secondaryClubId_idx" ON "Partnership"("secondaryClubId");

-- CreateIndex
CREATE INDEX "Partnership_user1Id_idx" ON "Partnership"("user1Id");

-- CreateIndex
CREATE INDEX "Partnership_user2Id_idx" ON "Partnership"("user2Id");

-- CreateIndex
CREATE INDEX "Partnership_endDate_idx" ON "Partnership"("endDate");

-- CreateIndex
CREATE INDEX "Partnership_status_idx" ON "Partnership"("status");

-- CreateIndex
CREATE INDEX "SoloTeam_clubId_idx" ON "SoloTeam"("clubId");

-- CreateIndex
CREATE INDEX "SoloTeamMember_teamId_idx" ON "SoloTeamMember"("teamId");

-- CreateIndex
CREATE INDEX "SoloTeamMember_userId_idx" ON "SoloTeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SoloTeamMember_teamId_userId_key" ON "SoloTeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_ffdId_key" ON "Competition"("ffdId");

-- CreateIndex
CREATE INDEX "Competition_date_idx" ON "Competition"("date");

-- CreateIndex
CREATE INDEX "Competition_status_idx" ON "Competition"("status");

-- CreateIndex
CREATE INDEX "Competition_ffdId_idx" ON "Competition"("ffdId");

-- CreateIndex
CREATE INDEX "Competition_city_idx" ON "Competition"("city");

-- CreateIndex
CREATE INDEX "Competition_competitionType_idx" ON "Competition"("competitionType");

-- CreateIndex
CREATE INDEX "Competition_status_date_idx" ON "Competition"("status", "date");

-- CreateIndex
CREATE INDEX "Event_competitionId_idx" ON "Event"("competitionId");

-- CreateIndex
CREATE INDEX "Event_category_idx" ON "Event"("category");

-- CreateIndex
CREATE INDEX "Event_ageGroup_idx" ON "Event"("ageGroup");

-- CreateIndex
CREATE INDEX "Event_eventType_idx" ON "Event"("eventType");

-- CreateIndex
CREATE INDEX "Event_eventKind_idx" ON "Event"("eventKind");

-- CreateIndex
CREATE INDEX "Event_competitionId_eventType_idx" ON "Event"("competitionId", "eventType");

-- CreateIndex
CREATE INDEX "Registration_eventId_idx" ON "Registration"("eventId");

-- CreateIndex
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");

-- CreateIndex
CREATE INDEX "Registration_partnerUserId_idx" ON "Registration"("partnerUserId");

-- CreateIndex
CREATE INDEX "Registration_status_idx" ON "Registration"("status");

-- CreateIndex
CREATE INDEX "Registration_checkedIn_idx" ON "Registration"("checkedIn");

-- CreateIndex
CREATE INDEX "Registration_eventId_userId_idx" ON "Registration"("eventId", "userId");

-- CreateIndex
CREATE INDEX "Registration_userId_status_idx" ON "Registration"("userId", "status");

-- CreateIndex
CREATE INDEX "Registration_eventId_status_idx" ON "Registration"("eventId", "status");

-- CreateIndex
CREATE INDEX "Registration_eventId_status_userId_idx" ON "Registration"("eventId", "status", "userId");

-- CreateIndex
CREATE INDEX "Result_userId_createdAt_idx" ON "Result"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Result_eventId_idx" ON "Result"("eventId");

-- CreateIndex
CREATE INDEX "ScheduleItem_competitionId_idx" ON "ScheduleItem"("competitionId");

-- CreateIndex
CREATE INDEX "ScheduleItem_competitionId_startTime_idx" ON "ScheduleItem"("competitionId", "startTime");

-- CreateIndex
CREATE INDEX "ScheduleItem_eventId_idx" ON "ScheduleItem"("eventId");

-- CreateIndex
CREATE INDEX "SeatBooking_competitionId_idx" ON "SeatBooking"("competitionId");

-- CreateIndex
CREATE INDEX "SeatBooking_userId_idx" ON "SeatBooking"("userId");

-- CreateIndex
CREATE INDEX "SeatBooking_competitionId_itemId_seatLabel_idx" ON "SeatBooking"("competitionId", "itemId", "seatLabel");

-- CreateIndex
CREATE UNIQUE INDEX "License_number_key" ON "License"("number");

-- CreateIndex
CREATE UNIQUE INDEX "License_userId_key" ON "License"("userId");

-- CreateIndex
CREATE INDEX "License_number_idx" ON "License"("number");

-- CreateIndex
CREATE INDEX "License_userId_idx" ON "License"("userId");

-- CreateIndex
CREATE INDEX "LicenseRenewalRequest_userId_idx" ON "LicenseRenewalRequest"("userId");

-- CreateIndex
CREATE INDEX "LicenseRenewalRequest_status_idx" ON "LicenseRenewalRequest"("status");

-- CreateIndex
CREATE INDEX "LicenseRenewalDocument_requestId_idx" ON "LicenseRenewalDocument"("requestId");

-- CreateIndex
CREATE INDEX "LicenseRenewalDocument_type_idx" ON "LicenseRenewalDocument"("type");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "Track_sourceKey_key" ON "Track"("sourceKey");

-- CreateIndex
CREATE INDEX "Track_submittedById_idx" ON "Track"("submittedById");

-- CreateIndex
CREATE INDEX "Track_sourceKey_status_idx" ON "Track"("sourceKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_clubName_idx" ON "User"("clubName");

-- CreateIndex
CREATE INDEX "User_clubId_idx" ON "User"("clubId");

-- CreateIndex
CREATE INDEX "User_clubId_role_idx" ON "User"("clubId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revoked_idx" ON "RefreshToken"("userId", "revoked");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_used_idx" ON "PasswordResetToken"("used");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerToken_token_key" ON "VolunteerToken"("token");

-- CreateIndex
CREATE INDEX "VolunteerToken_token_idx" ON "VolunteerToken"("token");

-- CreateIndex
CREATE INDEX "VolunteerToken_competitionId_idx" ON "VolunteerToken"("competitionId");

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_secondaryClubId_fkey" FOREIGN KEY ("secondaryClubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloTeam" ADD CONSTRAINT "SoloTeam_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloTeamMember" ADD CONSTRAINT "SoloTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SoloTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloTeamMember" ADD CONSTRAINT "SoloTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatBooking" ADD CONSTRAINT "SeatBooking_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatBooking" ADD CONSTRAINT "SeatBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseRenewalRequest" ADD CONSTRAINT "LicenseRenewalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseRenewalDocument" ADD CONSTRAINT "LicenseRenewalDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LicenseRenewalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerToken" ADD CONSTRAINT "VolunteerToken_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

