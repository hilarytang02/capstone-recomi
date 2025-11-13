import type { User } from "firebase/auth"
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as limitQuery,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore"

import { firestore } from "../firebase/app"

export const USERS_COLLECTION = "users"
export const USER_FOLLOWS_COLLECTION = "userFollows"

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === "object" && "toDate" in value && typeof (value as any).toDate === "function") {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

export type UserDocument = {
  displayName?: string | null
  photoURL?: string | null
  email?: string | null
  username?: string | null
  usernameLowercase?: string | null
  bio?: string | null
  homeCity?: string | null
  followersCount?: number
  followingCount?: number
  createdAt?: Date | null
  updatedAt?: Date | null
  lists?: unknown
  entries?: unknown
}

export type UserProfile = {
  id: string
  displayName: string | null
  photoURL: string | null
  email: string | null
  username: string | null
  usernameLowercase: string | null
  bio: string | null
  homeCity: string | null
  followersCount: number
  followingCount: number
  createdAt: Date | null
  updatedAt: Date | null
}

export type FollowCounts = {
  followers: number
  following: number
}

export type ListUsersOptions = {
  search?: string
  limit?: number
  excludeUid?: string
  cursor?: QueryDocumentSnapshot<UserDocument>
}

export type ListUsersResult = {
  users: UserProfile[]
  cursor: QueryDocumentSnapshot<UserDocument> | null
}

const DEFAULT_LIMIT = 25

const sanitizeUsername = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")

const buildFallbackUsername = (user: User) => {
  const fromDisplay = user.displayName?.replace(/\s+/g, "")
  const candidateFromDisplay = fromDisplay ? sanitizeUsername(fromDisplay) : ""
  if (candidateFromDisplay) {
    return candidateFromDisplay
  }
  const fromEmail = user.email?.split("@")[0]
  const emailCandidate = fromEmail ? sanitizeUsername(fromEmail) : ""
  if (emailCandidate) {
    return emailCandidate
  }
  return `recomi${user.uid.slice(0, 6)}`
}

const toUserProfile = (snapshot: QueryDocumentSnapshot<UserDocument>): UserProfile => {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
    email: data.email ?? null,
    username: data.username ?? null,
    usernameLowercase: data.usernameLowercase ?? null,
    bio: data.bio ?? null,
    homeCity: data.homeCity ?? null,
    followersCount: data.followersCount ?? 0,
    followingCount: data.followingCount ?? 0,
    createdAt: toDate(data.createdAt ?? null),
    updatedAt: toDate(data.updatedAt ?? null),
  }
}

export async function upsertUserProfileFromAuth(user: User, overrides: Partial<UserDocument> = {}) {
  const ref = doc(firestore, USERS_COLLECTION, user.uid)

  await runTransaction(firestore, async (tx) => {
    const snapshot = await tx.get(ref)
    const exists = snapshot.exists()
    const data = (snapshot.data() ?? {}) as UserDocument

    const preferredUsername = overrides.username ?? data.username ?? null
    const baseUsername = preferredUsername?.trim() || buildFallbackUsername(user)
    const normalizedUsername = sanitizeUsername(baseUsername) || buildFallbackUsername(user)

    const payload: Record<string, unknown> = {
      displayName: overrides.displayName ?? data.displayName ?? user.displayName ?? null,
      photoURL: overrides.photoURL ?? data.photoURL ?? user.photoURL ?? null,
      email: overrides.email ?? data.email ?? user.email ?? null,
      username: normalizedUsername,
      usernameLowercase: normalizedUsername,
      bio: overrides.bio ?? data.bio ?? null,
      homeCity: overrides.homeCity ?? data.homeCity ?? null,
      followersCount: data.followersCount ?? 0,
      followingCount: data.followingCount ?? 0,
      updatedAt: serverTimestamp(),
    }

    if (!exists) {
      payload.createdAt = serverTimestamp()
    }

    tx.set(ref, payload, { merge: true })
  })
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc<UserDocument>(firestore, USERS_COLLECTION, uid))
  if (!snapshot.exists()) {
    return null
  }
  return toUserProfile(snapshot as QueryDocumentSnapshot<UserDocument>)
}

export async function listUserProfiles(options: ListUsersOptions = {}): Promise<ListUsersResult> {
  const { search, limit = DEFAULT_LIMIT, excludeUid, cursor } = options
  const usersRef = collection<UserDocument>(firestore, USERS_COLLECTION)

  const constraints: QueryConstraint[] = []

  if (search) {
    const normalized = sanitizeUsername(search)
    const upperBound = `${normalized}\uf8ff`
    constraints.push(
      where("usernameLowercase", ">=", normalized),
      where("usernameLowercase", "<=", upperBound),
      orderBy("usernameLowercase", "asc"),
    )
  } else {
    constraints.push(orderBy("displayName", "asc"))
  }

  constraints.push(limitQuery(limit))

  if (cursor) {
    constraints.push(startAfter(cursor))
  }

  const snapshot = await getDocs(query(usersRef, ...constraints))
  const docs = snapshot.docs as QueryDocumentSnapshot<UserDocument>[]

  const users = docs
    .map((docSnapshot) => toUserProfile(docSnapshot))
    .filter((profile) => (excludeUid ? profile.id !== excludeUid : true))

  return {
    users,
    cursor: docs.length ? docs[docs.length - 1] : null,
  }
}

const followDocId = (followerId: string, followeeId: string) =>
  `${followerId}_${followeeId}`

export async function followUser(followerId: string, followeeId: string) {
  if (followerId === followeeId) {
    throw new Error("You cannot follow yourself.")
  }

  const followRef = doc(firestore, USER_FOLLOWS_COLLECTION, followDocId(followerId, followeeId))
  const followerRef = doc(firestore, USERS_COLLECTION, followerId)
  const followeeRef = doc(firestore, USERS_COLLECTION, followeeId)

  await runTransaction(firestore, async (tx) => {
    const existing = await tx.get(followRef)
    if (existing.exists()) {
      return
    }

    tx.set(followRef, {
      followerId,
      followeeId,
      createdAt: serverTimestamp(),
    })

    tx.update(followerRef, {
      followingCount: increment(1),
      updatedAt: serverTimestamp(),
    })
    tx.update(followeeRef, {
      followersCount: increment(1),
      updatedAt: serverTimestamp(),
    })
  })
}

export async function unfollowUser(followerId: string, followeeId: string) {
  if (followerId === followeeId) {
    return
  }

  const followRef = doc(firestore, USER_FOLLOWS_COLLECTION, followDocId(followerId, followeeId))
  const followerRef = doc(firestore, USERS_COLLECTION, followerId)
  const followeeRef = doc(firestore, USERS_COLLECTION, followeeId)

  await runTransaction(firestore, async (tx) => {
    const existing = await tx.get(followRef)
    if (!existing.exists()) {
      return
    }

    tx.delete(followRef)
    tx.update(followerRef, {
      followingCount: increment(-1),
      updatedAt: serverTimestamp(),
    })
    tx.update(followeeRef, {
      followersCount: increment(-1),
      updatedAt: serverTimestamp(),
    })
  })
}

export async function isFollowing(followerId: string, followeeId: string) {
  if (!followerId || !followeeId) {
    return false
  }
  const snapshot = await getDoc(
    doc(firestore, USER_FOLLOWS_COLLECTION, followDocId(followerId, followeeId))
  )
  return snapshot.exists()
}

export async function getFollowCounts(uid: string): Promise<FollowCounts> {
  const profile = await getUserProfile(uid)
  return {
    followers: profile?.followersCount ?? 0,
    following: profile?.followingCount ?? 0,
  }
}
