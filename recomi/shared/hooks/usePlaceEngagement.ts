import React from "react"
import { doc, getDoc, onSnapshot } from "firebase/firestore"

import { firestore } from "../firebase/app"
import { useSocialGraph } from "../context/socialGraph"
import {
  PLACE_STATS_COLLECTION,
  PLACE_USER_SAVES_SUBCOLLECTION,
  RECENT_PLACE_SAVERS_LIMIT,
  placeIdFromPin,
  type PlacePin,
  type PlaceStatsDocument,
} from "../utils/placeStats"

type EngagementProfile = {
  id: string
  displayName: string | null
  username: string | null
  photoURL: string | null
}

type PlaceEngagementTransition = {
  from: "wishlist" | "favourite" | "none" | null
  to: "wishlist" | "favourite" | "none" | null
} | null

type UsePlaceEngagementResult = {
  wishlistCount: number
  favouriteCount: number
  hasSnapshot: boolean
  friendsResolved: boolean
  wishlistFriend: EngagementProfile | null
  favouriteFriend: EngagementProfile | null
  matchedProfiles: EngagementProfile[]
}

const emptyState = {
  wishlistCount: 0,
  favouriteCount: 0,
  recentSaverIds: [] as string[],
  recentWishlistSaverIds: [] as string[],
  recentFavouriteSaverIds: [] as string[],
}

const countsCache = new Map<
  string,
  {
    wishlistCount: number
    favouriteCount: number
    recentSaverIds: string[]
    recentWishlistSaverIds: string[]
    recentFavouriteSaverIds: string[]
  }
>()

const toMillis = (value: unknown) => {
  if (!value) return 0
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "object" && "toMillis" in value && typeof (value as any).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

export const applyPlaceEngagementTransition = (
  state: typeof emptyState,
  transition: PlaceEngagementTransition,
) => {
  if (!transition || transition.from === transition.to) {
    return state
  }

  const next = {
    ...state,
    recentSaverIds: [...state.recentSaverIds],
    recentWishlistSaverIds: [...state.recentWishlistSaverIds],
    recentFavouriteSaverIds: [...state.recentFavouriteSaverIds],
  }

  if (transition.from === "wishlist") {
    next.wishlistCount = Math.max(0, next.wishlistCount - 1)
  } else if (transition.from === "favourite") {
    next.favouriteCount = Math.max(0, next.favouriteCount - 1)
  }

  if (transition.to === "wishlist") {
    next.wishlistCount += 1
  } else if (transition.to === "favourite") {
    next.favouriteCount += 1
  }

  return next
}

export const toEngagementProfile = (
  id: string,
  profile:
    | {
        displayName: string | null
        username: string | null
        photoURL: string | null
      }
    | undefined
): EngagementProfile => ({
  id,
  displayName: profile?.displayName ?? null,
  username: profile?.username ?? null,
  photoURL: profile?.photoURL ?? null,
})

export const buildMatchedProfiles = ({
  recentSaverIds,
  relatedUserIds,
  relatedProfiles,
}: {
  recentSaverIds: string[]
  relatedUserIds: string[]
  relatedProfiles: Map<
    string,
    {
      displayName: string | null
      username: string | null
      photoURL: string | null
    }
  >
}) => {
  if (!relatedUserIds.length || !recentSaverIds.length) {
    return [] as EngagementProfile[]
  }
  const relatedSet = new Set(relatedUserIds)
  return recentSaverIds
    .filter((id) => relatedSet.has(id))
    .map((id) => toEngagementProfile(id, relatedProfiles.get(id)))
}

export const pickMatchedProfile = ({
  saverIds,
  relatedUserIds,
  relatedProfiles,
}: {
  saverIds: string[]
  relatedUserIds: string[]
  relatedProfiles: Map<
    string,
    {
      displayName: string | null
      username: string | null
      photoURL: string | null
    }
  >
}) => {
  const relatedSet = new Set(relatedUserIds)
  const match = saverIds.find((id) => relatedSet.has(id))
  return match ? toEngagementProfile(match, relatedProfiles.get(match)) : null
}

export function usePlaceEngagement(
  pin: PlacePin | null,
  transition: PlaceEngagementTransition = null,
): UsePlaceEngagementResult {
  const { relatedUserIds, relatedProfiles, loading: socialGraphLoading } = useSocialGraph()
  const [state, setState] = React.useState(emptyState)
  const [hasSnapshot, setHasSnapshot] = React.useState(false)
  const [needsLegacyFallback, setNeedsLegacyFallback] = React.useState(false)
  const [legacyRecentState, setLegacyRecentState] = React.useState<typeof emptyState | null>(null)
  const placeId = React.useMemo(() => (pin ? placeIdFromPin(pin) : null), [pin])

  React.useEffect(() => {
    if (!placeId) {
      setState(emptyState)
      setHasSnapshot(false)
      setNeedsLegacyFallback(false)
      setLegacyRecentState(null)
      return
    }

    const cached = countsCache.get(placeId)
    if (cached) {
      setState(cached)
      setHasSnapshot(true)
    } else {
      setState(emptyState)
      setHasSnapshot(false)
    }

    const unsubscribe = onSnapshot(doc(firestore, PLACE_STATS_COLLECTION, placeId), (snapshot) => {
      if (!snapshot.exists()) {
        countsCache.set(placeId, emptyState)
        setState(emptyState)
        setHasSnapshot(true)
        return
      }

      const data = snapshot.data() as PlaceStatsDocument
      const nextState = {
        wishlistCount: typeof data.wishlistCount === "number" ? data.wishlistCount : 0,
        favouriteCount: typeof data.favouriteCount === "number" ? data.favouriteCount : 0,
        recentSaverIds: Array.isArray(data.recentSaverIds) ? data.recentSaverIds : [],
        recentWishlistSaverIds: Array.isArray(data.recentWishlistSaverIds) ? data.recentWishlistSaverIds : [],
        recentFavouriteSaverIds: Array.isArray(data.recentFavouriteSaverIds) ? data.recentFavouriteSaverIds : [],
      }
      const hasRecentArrays =
        Array.isArray(data.recentSaverIds) ||
        Array.isArray(data.recentWishlistSaverIds) ||
        Array.isArray(data.recentFavouriteSaverIds)
      countsCache.set(placeId, nextState)
      setState(nextState)
      setHasSnapshot(true)
      setNeedsLegacyFallback(!hasRecentArrays && nextState.wishlistCount + nextState.favouriteCount > 0)
      if (hasRecentArrays || nextState.wishlistCount + nextState.favouriteCount === 0) {
        setLegacyRecentState(null)
      }
    })

    return unsubscribe
  }, [placeId])

  React.useEffect(() => {
    let active = true

    if (!placeId || !needsLegacyFallback) {
      setLegacyRecentState(null)
      return
    }

    if (socialGraphLoading) {
      return
    }

    const loadLegacyRecentState = async () => {
      if (!relatedUserIds.length) {
        if (active) {
          setLegacyRecentState(emptyState)
        }
        return
      }

      const candidateIds = relatedUserIds.slice(0, RECENT_PLACE_SAVERS_LIMIT)
      const saveSnaps = await Promise.all(
        candidateIds.map((id) =>
          getDoc(doc(firestore, PLACE_STATS_COLLECTION, placeId, PLACE_USER_SAVES_SUBCOLLECTION, id))
        )
      )

      const records = saveSnaps
        .map((snapshot, index) => {
          if (!snapshot.exists()) return null
          const data = snapshot.data() as { bucket?: string; savedAt?: unknown }
          const bucket = data.bucket === "wishlist" || data.bucket === "favourite" ? data.bucket : null
          if (!bucket) return null
          return {
            id: candidateIds[index],
            bucket,
            savedAt: toMillis(data.savedAt),
          }
        })
        .filter((record): record is { id: string; bucket: "wishlist" | "favourite"; savedAt: number } => Boolean(record))
        .sort((a, b) => b.savedAt - a.savedAt)

      if (!active) return

      setLegacyRecentState({
        wishlistCount: state.wishlistCount,
        favouriteCount: state.favouriteCount,
        recentSaverIds: records.map((record) => record.id),
        recentWishlistSaverIds: records.filter((record) => record.bucket === "wishlist").map((record) => record.id),
        recentFavouriteSaverIds: records.filter((record) => record.bucket === "favourite").map((record) => record.id),
      })
    }

    void loadLegacyRecentState().catch((error) => {
      console.warn("Failed to load legacy place engagement", error)
      if (active) {
        setLegacyRecentState(emptyState)
      }
    })

    return () => {
      active = false
    }
  }, [needsLegacyFallback, placeId, relatedUserIds, socialGraphLoading, state.favouriteCount, state.wishlistCount])

  const effectiveState = React.useMemo(
    () => applyPlaceEngagementTransition(legacyRecentState ?? state, transition),
    [legacyRecentState, state, transition]
  )

  const matchedProfiles = React.useMemo(() => {
    return buildMatchedProfiles({
      recentSaverIds: effectiveState.recentSaverIds,
      relatedUserIds,
      relatedProfiles,
    })
  }, [effectiveState.recentSaverIds, relatedProfiles, relatedUserIds])

  const wishlistFriend = React.useMemo(() => {
    return pickMatchedProfile({
      saverIds: effectiveState.recentWishlistSaverIds,
      relatedUserIds,
      relatedProfiles,
    })
  }, [effectiveState.recentWishlistSaverIds, relatedProfiles, relatedUserIds])

  const favouriteFriend = React.useMemo(() => {
    return pickMatchedProfile({
      saverIds: effectiveState.recentFavouriteSaverIds,
      relatedUserIds,
      relatedProfiles,
    })
  }, [effectiveState.recentFavouriteSaverIds, relatedProfiles, relatedUserIds])

  return {
    wishlistCount: effectiveState.wishlistCount,
    favouriteCount: effectiveState.favouriteCount,
    hasSnapshot,
    friendsResolved: hasSnapshot && !socialGraphLoading && (!needsLegacyFallback || legacyRecentState !== null),
    wishlistFriend,
    favouriteFriend,
    matchedProfiles,
  }
}
