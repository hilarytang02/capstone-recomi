#!/usr/bin/env node
/* eslint-disable no-console */
const admin = require("firebase-admin");

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");
const projectArgIndex = process.argv.indexOf("--project");
const projectId = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : undefined;

if (projectArgIndex >= 0 && !projectId) {
  console.error("Missing value for --project");
  process.exit(1);
}

admin.initializeApp(
  projectId
    ? {
        projectId,
        credential: admin.credential.applicationDefault(),
      }
    : undefined
);

const db = admin.firestore();
const PLACE_STATS_COLLECTION = "placeStats";
const PLACE_USER_SAVES_SUBCOLLECTION = "userSaves";
const BATCH_LIMIT = 400;
const RECENT_LIMIT = 24;

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  return 0;
};

const pickRecentIds = (records, bucket) =>
  records
    .filter((record) => !bucket || record.bucket === bucket)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((record) => record.userId)
    .slice(0, RECENT_LIMIT);

async function collectPlaceUpdates() {
  const placeStatsSnapshot = await db.collection(PLACE_STATS_COLLECTION).get();
  const updates = [];

  for (const docSnap of placeStatsSnapshot.docs) {
    const userSavesSnapshot = await docSnap.ref.collection(PLACE_USER_SAVES_SUBCOLLECTION).get();
    const records = userSavesSnapshot.docs
      .map((saveSnap) => {
        const data = saveSnap.data();
        const userId = typeof data.userId === "string" ? data.userId : saveSnap.id;
        const bucket = data.bucket === "favourite" ? "favourite" : data.bucket === "wishlist" ? "wishlist" : null;
        if (!userId || !bucket) {
          return null;
        }
        return {
          userId,
          bucket,
          savedAt: toMillis(data.savedAt),
        };
      })
      .filter(Boolean);

    updates.push({
      ref: docSnap.ref,
      recentSaverIds: pickRecentIds(records, null),
      recentWishlistSaverIds: pickRecentIds(records, "wishlist"),
      recentFavouriteSaverIds: pickRecentIds(records, "favourite"),
    });
  }

  return updates;
}

async function applyUpdates(updates) {
  let batch = db.batch();
  let writes = 0;

  for (const update of updates) {
    batch.set(
      update.ref,
      {
        recentSaverIds: update.recentSaverIds,
        recentWishlistSaverIds: update.recentWishlistSaverIds,
        recentFavouriteSaverIds: update.recentFavouriteSaverIds,
      },
      { merge: true }
    );
    writes += 1;

    if (writes >= BATCH_LIMIT) {
      if (!isDryRun) {
        await batch.commit();
      }
      batch = db.batch();
      writes = 0;
    }
  }

  if (writes > 0 && !isDryRun) {
    await batch.commit();
  }
}

async function main() {
  console.log("Backfilling place recent savers", isDryRun ? "(dry run)" : "");
  const updates = await collectPlaceUpdates();
  console.log(`Places to update: ${updates.length}`);

  if (isDryRun) {
    console.log("Dry run complete. No writes performed.");
    return;
  }

  await applyUpdates(updates);
  console.log("Backfill complete.");
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});
