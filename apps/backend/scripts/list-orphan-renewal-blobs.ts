/**
 * One-off inventory of orphaned license renewal document blobs (GDPR art. 9:
 * medical certificates are health data).
 *
 * LIST ONLY — this script never deletes anything.
 *
 * Lists the blobs of the uploads container (AZURE_STORAGE_UPLOADS_CONTAINER,
 * default "uploads") whose name matches the renewal document naming scheme
 * (`document-<epochMs>-<random>.<ext>`, see generateBlobName) and that no
 * `LicenseRenewalDocument.filePath` references. Such blobs were left behind
 * by the former behaviour (re-uploading a document never deleted the replaced
 * blob; account deletion never deleted files) or by a failed best-effort
 * deletion (reported to Sentry with tag `rgpd: file-deletion-failed`).
 *
 * Prints name + lastModified for each orphan, then the count. Review the list,
 * then delete manually (Azure portal / az storage blob delete).
 *
 * Env (read from apps/backend/.env like the other scripts):
 *   DATABASE_URL                                     required
 *   AZURE_STORAGE_CONNECTION_STRING | AZURE_STORAGE_ACCOUNT_NAME   required
 *   AZURE_STORAGE_UPLOADS_CONTAINER                  optional (default "uploads")
 *
 * Usage:
 *   pnpm --filter backend exec tsx scripts/list-orphan-renewal-blobs.ts
 */
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  BlobListing,
  findOrphanRenewalBlobs,
  isRenewalDocumentBlobName,
} from "./list-orphan-renewal-blobs.utils";

/** Page size when reading referenced file paths (no unbounded findMany). */
const DB_PAGE_SIZE = 1000;

function createBlobServiceClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (accountName) {
    return new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  console.error(
    "AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME is required",
  );
  process.exit(1);
}

async function loadReferencedFilePaths(
  prisma: PrismaClient,
): Promise<string[]> {
  const filePaths: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.licenseRenewalDocument.findMany({
      select: { id: true, filePath: true },
      orderBy: { id: "asc" },
      take: DB_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    for (const doc of page) filePaths.push(doc.filePath);
    if (page.length < DB_PAGE_SIZE) return filePaths;
    cursor = page[page.length - 1].id;
  }
}

async function listRenewalBlobs(
  client: BlobServiceClient,
  containerName: string,
): Promise<BlobListing[]> {
  const container = client.getContainerClient(containerName);
  const blobs: BlobListing[] = [];
  // Server-side prefix narrows the listing; the strict name pattern is then
  // applied client-side so that only renewal documents are ever considered.
  for await (const blob of container.listBlobsFlat({ prefix: "document-" })) {
    if (isRenewalDocumentBlobName(blob.name)) {
      blobs.push({
        name: blob.name,
        lastModified: blob.properties.lastModified,
      });
    }
  }
  return blobs;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const containerName =
    process.env.AZURE_STORAGE_UPLOADS_CONTAINER ?? "uploads";
  const blobClient = createBlobServiceClient();

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const [referenced, blobs] = await Promise.all([
      loadReferencedFilePaths(prisma),
      listRenewalBlobs(blobClient, containerName),
    ]);
    const orphans = findOrphanRenewalBlobs(blobs, referenced);

    console.log(
      `Container "${containerName}": ${blobs.length} renewal document blob(s), ${referenced.length} DB reference(s).`,
    );
    for (const orphan of orphans) {
      console.log(
        `${orphan.name}\t${orphan.lastModified?.toISOString() ?? "unknown"}`,
      );
    }
    console.log(`Orphan renewal document blobs: ${orphans.length}`);
    console.log("List only — nothing was deleted.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
