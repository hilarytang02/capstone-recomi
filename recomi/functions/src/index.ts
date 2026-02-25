import * as admin from "firebase-admin";
import * as functionsV1 from "firebase-functions/v1";
import { logger } from "firebase-functions/logger";
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";

admin.initializeApp();
const db = admin.firestore();
const USERS_COLLECTION = "users";
const USER_FOLLOWS_COLLECTION = "userFollows";
const INVITES_COLLECTION = "invites";
const LIST_LIKES_COLLECTION = "listLikes";

async function deleteQueryBatch(query: admin.firestore.Query, batchSize = 250): Promise<void> {
  const snapshot = await query.limit(batchSize).get();
  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((docSnap: admin.firestore.QueryDocumentSnapshot) => batch.delete(docSnap.ref));
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

export const cleanupUserProfile = functionsV1
  .region("us-central1")
  .auth.user()
  .onDelete(async (user: functionsV1.auth.UserRecord) => {
    const uid = user.uid;
    logger.info("Cleaning up user", { uid });

    await db
      .collection("users")
      .doc(uid)
      .delete()
      .catch((err: unknown) => {
        const error = err as { code?: string };
        if (error.code !== "not-found") {
          throw err;
        }
      });

    await deleteUserFollows(uid);

    logger.info("Finished cleanup for", { uid });
  });

const normalizeCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const clampCount = (value: number, delta: number) => {
  const next = value + delta;
  return next < 0 ? 0 : next;
};

async function adjustFollowStats(followerId: string, followeeId: string, delta: 1 | -1): Promise<void> {
  if (!followerId || !followeeId || followerId === followeeId) {
    return;
  }

  const followerRef = db.collection(USERS_COLLECTION).doc(followerId);
  const followeeRef = db.collection(USERS_COLLECTION).doc(followeeId);

  await db.runTransaction(async (tx: admin.firestore.Transaction) => {
    const followerSnap = await tx.get(followerRef);
    if (followerSnap.exists) {
      const currentFollowing = normalizeCount(followerSnap.get("followingCount"));
      tx.update(followerRef, { followingCount: clampCount(currentFollowing, delta) });
    }

    const followeeSnap = await tx.get(followeeRef);
    if (followeeSnap.exists) {
      const currentFollowers = normalizeCount(followeeSnap.get("followersCount"));
      tx.update(followeeRef, { followersCount: clampCount(currentFollowers, delta) });
    }
  });
}

async function adjustListSaves(ownerId: string, listId: string, delta: 1 | -1): Promise<void> {
  if (!ownerId || !listId) {
    return;
  }

  const listRef = db.collection(USERS_COLLECTION).doc(ownerId).collection("lists").doc(listId);
  await db.runTransaction(async (tx: admin.firestore.Transaction) => {
    const listSnap = await tx.get(listRef);
    if (!listSnap.exists) {
      return;
    }
    const current = normalizeCount(listSnap.get("savesCount"));
    tx.update(listRef, { savesCount: clampCount(current, delta) });
  });
}

export const onFollowCreated = onDocumentCreated(
  { region: "us-central1", document: `${USER_FOLLOWS_COLLECTION}/{followId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }
    const data = snapshot.data();
    const followerId = data?.followerId;
    const followeeId = data?.followeeId;
    if (!followerId || !followeeId) {
      return;
    }
    await adjustFollowStats(followerId, followeeId, 1);
  }
);

export const onFollowDeleted = onDocumentDeleted(
  { region: "us-central1", document: `${USER_FOLLOWS_COLLECTION}/{followId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }
    const data = snapshot.data();
    const followerId = data?.followerId;
    const followeeId = data?.followeeId;
    if (!followerId || !followeeId) {
      return;
    }
    await adjustFollowStats(followerId, followeeId, -1);
  }
);

export const onInviteCreated = onDocumentCreated(
  { region: "us-central1", document: `${INVITES_COLLECTION}/{inviteId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data();
    const toUserId = data?.toUserId;
    const fromUserId = data?.fromUserId;
    const placeLabel = data?.placeLabel ?? "a place";
    if (!toUserId || !fromUserId) return;

    const toUserSnap = await db.collection(USERS_COLLECTION).doc(toUserId).get();
    const toUser = toUserSnap.exists ? toUserSnap.data() : null;
    const tokens = Array.isArray(toUser?.fcmTokens) ? (toUser?.fcmTokens as string[]) : [];
    if (!tokens.length) {
      logger.info("Invite created but no FCM tokens for user", { toUserId });
      return;
    }

    const fromUserSnap = await db.collection(USERS_COLLECTION).doc(fromUserId).get();
    const fromUser = fromUserSnap.exists ? fromUserSnap.data() : null;
    const fromName = fromUser?.displayName ?? fromUser?.username ?? "Someone";

    const payload: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: `${fromName} invited you`,
        body: `Want to go to ${placeLabel} together?`,
      },
      data: {
        type: "invite",
        fromUserId,
        placeLabel,
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(payload);
      logger.info("Invite push sent", { toUserId, successCount: response.successCount });
    } catch (error) {
      logger.error("Failed to send invite push", error);
    }
  }
);

export const onListLikeCreated = onDocumentCreated(
  { region: "us-central1", document: `${LIST_LIKES_COLLECTION}/{likeId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data();
    const ownerId = data?.ownerId;
    const listId = data?.listId;
    if (!ownerId || !listId) return;
    await adjustListSaves(ownerId, listId, 1);
  }
);

export const onListLikeDeleted = onDocumentDeleted(
  { region: "us-central1", document: `${LIST_LIKES_COLLECTION}/{likeId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data();
    const ownerId = data?.ownerId;
    const listId = data?.listId;
    if (!ownerId || !listId) return;
    await adjustListSaves(ownerId, listId, -1);
  }
);
