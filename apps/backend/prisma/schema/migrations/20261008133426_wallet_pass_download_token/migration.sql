-- CreateTable
CREATE TABLE "WalletPassDownloadToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletPassDownloadToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletPassDownloadToken_tokenHash_key" ON "WalletPassDownloadToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WalletPassDownloadToken_userId_idx" ON "WalletPassDownloadToken"("userId");

-- AddForeignKey
ALTER TABLE "WalletPassDownloadToken" ADD CONSTRAINT "WalletPassDownloadToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
