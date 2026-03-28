import React from "react"
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore"

import { useAuth } from "./auth"
import { firestore } from "../firebase/app"
import { USER_FOLLOWS_COLLECTION, USERS_COLLECTION } from "../api/users"

type SocialGraphProfile = {
  id: string
  displayName: string | null
  username: string | null
  photoURL: string | null
}

type SocialGraphContextValue = {
  followeeIds: string[]
  relatedUserIds: string[]
  relatedProfiles: Map<string, SocialGraphProfile>
  loading: boolean
}

const EMPTY_PROFILES = new Map<string, SocialGraphProfile>()
const profileCache = new Map<string, SocialGraphProfile>()

const SocialGraphContext = React.createContext<SocialGraphContextValue | undefined>(undefined)

export function SocialGraphProvider({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth()
  const [followeeIds, setFolloweeIds] = React.useState<string[]>([])
  const [relatedUserIds, setRelatedUserIds] = React.useState<string[]>([])
  const [relatedProfiles, setRelatedProfiles] = React.useState<Map<string, SocialGraphProfile>>(EMPTY_PROFILES)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!user?.uid || initializing) {
      setFolloweeIds([])
      setRelatedUserIds([])
      setRelatedProfiles(new Map())
      setLoading(false)
      return
    }

    setLoading(true)

    const followeesQuery = query(
      collection(firestore, USER_FOLLOWS_COLLECTION),
      where("followerId", "==", user.uid)
    )
    const followersQuery = query(
      collection(firestore, USER_FOLLOWS_COLLECTION),
      where("followeeId", "==", user.uid)
    )

    let followees: string[] = []
    let followers: string[] = []
    let active = true
    let followeesReady = false
    let followersReady = false
    let syncRequestId = 0

    const syncProfiles = async (ids: string[]) => {
      const requestId = ++syncRequestId
      const uniqueIds = Array.from(new Set(ids))
      if (!uniqueIds.length) {
        if (!active) return
        setRelatedProfiles(new Map())
        setLoading(false)
        return
      }

      const nextProfiles = new Map<string, SocialGraphProfile>()
      const missingIds: string[] = []

      uniqueIds.forEach((id) => {
        const cached = profileCache.get(id)
        if (cached) {
          nextProfiles.set(id, cached)
        } else {
          missingIds.push(id)
        }
      })

      if (missingIds.length) {
        const loadedProfiles = await Promise.all(
          missingIds.map(async (id) => {
            const snapshot = await getDoc(doc(firestore, USERS_COLLECTION, id))
            const data = snapshot.exists()
              ? (snapshot.data() as {
                  displayName?: string | null
                  username?: string | null
                  photoURL?: string | null
                })
              : {}
            const profile = {
              id,
              displayName: data.displayName ?? null,
              username: data.username ?? null,
              photoURL: data.photoURL ?? null,
            } satisfies SocialGraphProfile
            profileCache.set(id, profile)
            return profile
          })
        )
        loadedProfiles.forEach((profile) => nextProfiles.set(profile.id, profile))
      }

      if (!active || requestId !== syncRequestId) return
      setRelatedProfiles(nextProfiles)
      setLoading(false)
    }

    const updateState = () => {
      if (!followeesReady || !followersReady) {
        return
      }
      const orderedIds = [...followees, ...followers.filter((id) => !followees.includes(id))]
      setFolloweeIds(followees)
      setRelatedUserIds(orderedIds)
      void syncProfiles(orderedIds)
    }

    const unsubFollowees = onSnapshot(
      followeesQuery,
      (snapshot) => {
        followeesReady = true
        followees = snapshot.docs
          .map((docSnap) => (docSnap.data() as { followeeId?: string }).followeeId)
          .filter((id): id is string => Boolean(id))
        updateState()
      },
      (error) => {
        console.warn("Failed to load followees", error)
        if (!active) return
        followeesReady = true
        followees = []
        updateState()
      }
    )

    const unsubFollowers = onSnapshot(
      followersQuery,
      (snapshot) => {
        followersReady = true
        followers = snapshot.docs
          .map((docSnap) => (docSnap.data() as { followerId?: string }).followerId)
          .filter((id): id is string => Boolean(id))
        updateState()
      },
      (error) => {
        console.warn("Failed to load followers", error)
        if (!active) return
        followersReady = true
        followers = []
        updateState()
      }
    )

    return () => {
      active = false
      unsubFollowees()
      unsubFollowers()
    }
  }, [initializing, user?.uid])

  const value = React.useMemo(
    () => ({
      followeeIds,
      relatedUserIds,
      relatedProfiles,
      loading,
    }),
    [followeeIds, loading, relatedProfiles, relatedUserIds]
  )

  return (
    <SocialGraphContext.Provider value={value}>
      {children}
    </SocialGraphContext.Provider>
  )
}

export function useSocialGraph() {
  const context = React.useContext(SocialGraphContext)
  if (!context) {
    throw new Error("useSocialGraph must be used within a SocialGraphProvider.")
  }
  return context
}
