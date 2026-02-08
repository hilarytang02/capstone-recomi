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
const USER_FOLLOWS_COLLECTION = "userFollows";
const USERS_COLLECTION = "users";
const BATCH_LIMIT = 500;
const PAGE_SIZE = 1000;

async function collectCounts() {
  const followerCounts = new Map();
  const followingCounts = new Map();
  let lastDoc = null;
  let processed = 0;

  while (true) {
    let query = db.collection(USER_FOLLOWS_COLLECTION).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const followerId = data?.followerId;
      const followeeId = data?.followeeId;
      if (!followerId || !followeeId || followerId === followeeId) {
        return;
      }
      followerCounts.set(followerId, (followerCounts.get(followerId) ?? 0) + 1);
      followingCounts.set(followeeId, (followingCounts.get(followeeId) ?? 0) + 1);
      processed += 1;
    });

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  return { followerCounts, followingCounts, processed };
}

async function applyCounts(followerCounts, followingCounts) {
  const userIds = new Set([...followerCounts.keys(), ...followingCounts.keys()]);
  let batch = db.batch();
  let writes = 0;

  for (const uid of userIds) {
    const ref = db.collection(USERS_COLLECTION).doc(uid);
    const followersCount = followerCounts.get(uid) ?? 0;
    const followingCount = followingCounts.get(uid) ?? 0;
    batch.set(ref, { followersCount, followingCount }, { merge: true });
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
  console.log("Backfilling follow counts", isDryRun ? "(dry run)" : "");
  const { followerCounts, followingCounts, processed } = await collectCounts();
  console.log(`Processed follows: ${processed}`);
  console.log(`Users to update: ${new Set([...followerCounts.keys(), ...followingCounts.keys()]).size}`);

  if (isDryRun) {
    console.log("Dry run complete. No writes performed.");
    return;
  }

  await applyCounts(followerCounts, followingCounts);
  console.log("Backfill complete.");
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});
