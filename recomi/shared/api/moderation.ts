import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore"

import { firestore } from "../firebase/app"
import { USERS_COLLECTION } from "./users"

export const REPORTS_COLLECTION = "reports"

export type ReportTargetType = "user" | "list" | "place"

export type CreateReportInput = {
  reporterId: string
  targetType: ReportTargetType
  targetId: string
  targetUserId?: string | null
  listId?: string | null
  placeId?: string | null
  label?: string | null
  reason?: string | null
}

export async function createReport(input: CreateReportInput): Promise<void> {
  const trimmedReason = input.reason?.trim() ?? ""

  await addDoc(collection(firestore, REPORTS_COLLECTION), {
    reporterId: input.reporterId,
    targetType: input.targetType,
    targetId: input.targetId,
    targetUserId: input.targetUserId ?? null,
    listId: input.listId ?? null,
    placeId: input.placeId ?? null,
    label: input.label ?? null,
    reason: trimmedReason || null,
    createdAt: serverTimestamp(),
    status: "open",
  })
}

export async function blockUser(currentUserId: string, blockedUserId: string): Promise<void> {
  if (!currentUserId || !blockedUserId || currentUserId === blockedUserId) {
    throw new Error("Invalid block request.")
  }

  await setDoc(
    doc(firestore, USERS_COLLECTION, currentUserId),
    {
      blockedUsers: arrayUnion(blockedUserId),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

export async function unblockUser(currentUserId: string, blockedUserId: string): Promise<void> {
  if (!currentUserId || !blockedUserId || currentUserId === blockedUserId) {
    throw new Error("Invalid unblock request.")
  }

  await setDoc(
    doc(firestore, USERS_COLLECTION, currentUserId),
    {
      blockedUsers: arrayRemove(blockedUserId),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}
