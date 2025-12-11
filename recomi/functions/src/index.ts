import * as admin from "firebase-admin";
import type { FirestoreError } from "firebase-admin/firestore";
import * as functions from "firebase-functions";

admin.initializeApp();
const db = admin.firestore();

async function deleteQueryBatch(query: FirebaseFirestore.Query, batchSize = 250): Promise<void> {
  const snapshot = await query.limit(batchSize).get();
  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  if (snapshot.size >= batchSize) {
    return deleteQueryBatch(query, batchSize);
  }
}

async function deleteUserFollows(uid: string): Promise<void> {
  const followerQuery = db.collection("userFollows").where("followerId", "==", uid);
  const followeeQuery = db.collection("userFollows").where("followeeId", "==", uid);
  await Promise.all([deleteQueryBatch(followerQuery), deleteQueryBatch(followeeQuery)]);
}

export const cleanupUserProfile = functions
  .region("us-central1")
  .auth.user()
  .onDelete(async (user) => {
    const uid = user.uid;
    functions.logger.info("Cleaning up user", { uid });

    await db
      .collection("users")
      .doc(uid)
      .delete()
      .catch((err: FirestoreError) => {
        if (err.code !== "not-found") {
          throw err;
        }
      });

    await deleteUserFollows(uid);

    functions.logger.info("Finished cleanup for", { uid });
  });
