import React from "react"
import { doc, onSnapshot } from "firebase/firestore"

import { useAuth } from "./auth"
import { firestore } from "../firebase/app"
import { blockUser, unblockUser } from "../api/moderation"
import { USERS_COLLECTION } from "../api/users"

type ModerationContextValue = {
  blockedUserIds: string[]
  loading: boolean
  isBlockedUser: (uid: string | null | undefined) => boolean
  block: (uid: string) => Promise<void>
  unblock: (uid: string) => Promise<void>
}

const ModerationContext = React.createContext<ModerationContextValue | undefined>(undefined)

export function ModerationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [blockedUserIds, setBlockedUserIds] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!user?.uid) {
      setBlockedUserIds([])
      setLoading(false)
      return
    }

    setLoading(true)
    const unsubscribe = onSnapshot(
      doc(firestore, USERS_COLLECTION, user.uid),
      (snapshot) => {
        const data = snapshot.exists()
          ? (snapshot.data() as { blockedUsers?: unknown })
          : {}
        const nextBlocked = Array.isArray(data.blockedUsers)
          ? data.blockedUsers.filter((id): id is string => typeof id === "string")
          : []
        setBlockedUserIds(nextBlocked)
        setLoading(false)
      },
      (error) => {
        console.warn("Failed to load blocked users", error)
        setBlockedUserIds([])
        setLoading(false)
      }
    )

    return unsubscribe
  }, [user?.uid])

  const block = React.useCallback(
    async (uid: string) => {
      if (!user?.uid) {
        throw new Error("Sign in to block users.")
      }
      await blockUser(user.uid, uid)
    },
    [user?.uid]
  )

  const unblock = React.useCallback(
    async (uid: string) => {
      if (!user?.uid) {
        throw new Error("Sign in to unblock users.")
      }
      await unblockUser(user.uid, uid)
    },
    [user?.uid]
  )

  const isBlockedUser = React.useCallback(
    (uid: string | null | undefined) => Boolean(uid && blockedUserIds.includes(uid)),
    [blockedUserIds]
  )

  const value = React.useMemo(
    () => ({
      blockedUserIds,
      loading,
      isBlockedUser,
      block,
      unblock,
    }),
    [blockedUserIds, loading, isBlockedUser, block, unblock]
  )

  return <ModerationContext.Provider value={value}>{children}</ModerationContext.Provider>
}

export function useModeration() {
  const context = React.useContext(ModerationContext)
  if (!context) {
    throw new Error("useModeration must be used within a ModerationProvider.")
  }
  return context
}
