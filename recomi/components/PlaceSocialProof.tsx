import React from "react"
import { StyleSheet, Text, View } from "react-native"
import FontAwesome from "@expo/vector-icons/FontAwesome"
import {
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore"

import { firestore } from "../shared/firebase/app"
import { useAuth } from "../shared/context/auth"
import { useSocialGraph } from "../shared/context/socialGraph"
import {
  PLACE_STATS_COLLECTION,
  PLACE_USER_SAVES_SUBCOLLECTION,
  placeIdFromPin,
  type PlacePin,
} from "../shared/utils/placeStats"
import { getSocialProofLines } from "../shared/utils/socialProof"

type FriendLabel = {
  id: string
  label: string
}

type PlaceEngagement = {
  wishlistCount: number
  favouriteCount: number
  wishlistFriend: FriendLabel | null
  favouriteFriend: FriendLabel | null
  hasSnapshot: boolean
  friendsResolved: boolean
}

const MAX_FOLLOWEES_TO_CHECK = 50
const MIN_DISPLAY_MS = 900
const EMPTY_INCENTIVE_DELAY_MS = 700
const FRIEND_LABEL_GRACE_MS = 350

const toMillis = (value: unknown) => {
  if (!value) return 0
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "object" && "toMillis" in value && typeof (value as any).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

const formatUserLabel = (data: { username?: string | null; displayName?: string | null } | null) => {
  if (!data) return "Someone"
  if (data.username) return `@${data.username}`
  if (data.displayName) return data.displayName
  return "Someone"
}

const pickLatest = (candidates: Array<{ id: string; savedAt: number }>) => {
  if (!candidates.length) return null
  return candidates.reduce((best, next) => (next.savedAt > best.savedAt ? next : best)).id
}

const usePlaceEngagement = (
  pin: PlacePin | null,
  transition: { from: "wishlist" | "favourite" | "none" | null; to: "wishlist" | "favourite" | "none" | null } | null
): PlaceEngagement => {
  const { user, initializing } = useAuth()
  const { relatedUserIds, relatedProfiles, loading: socialGraphLoading } = useSocialGraph()
  const [counts, setCounts] = React.useState({ wishlistCount: 0, favouriteCount: 0 })
  const countsCacheRef = React.useRef<Map<string, { wishlistCount: number; favouriteCount: number }>>(new Map())
  const friendsCacheRef = React.useRef<
    Map<string, Pick<PlaceEngagement, "wishlistFriend" | "favouriteFriend">>
  >(new Map())
  const hasSnapshotRef = React.useRef<Map<string, boolean>>(new Map())
  const pendingWritesRef = React.useRef<Map<string, boolean>>(new Map())
  const lastTransitionRef = React.useRef<string | null>(null)
  const [hasSnapshot, setHasSnapshot] = React.useState(false)
  const [friends, setFriends] = React.useState<Pick<PlaceEngagement, "wishlistFriend" | "favouriteFriend">>({
    wishlistFriend: null,
    favouriteFriend: null,
  })
  const [friendsResolved, setFriendsResolved] = React.useState(false)

  React.useEffect(() => {
    if (!pin || !user?.uid || initializing) {
      setCounts({ wishlistCount: 0, favouriteCount: 0 })
      setFriends({ wishlistFriend: null, favouriteFriend: null })
      setFriendsResolved(false)
      return
    }

    const placeId = placeIdFromPin(pin)
    const cached = countsCacheRef.current.get(placeId)
    const cachedFriends = friendsCacheRef.current.get(placeId)
    if (cached) {
      setCounts(cached)
      setHasSnapshot(true)
    } else {
      setCounts({ wishlistCount: 0, favouriteCount: 0 })
      setHasSnapshot(false)
    }
    if (cachedFriends) {
      setFriends(cachedFriends)
      setFriendsResolved(true)
    }
    const ref = doc(firestore, PLACE_STATS_COLLECTION, placeId)
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      pendingWritesRef.current.set(placeId, snapshot.metadata.hasPendingWrites)
      if (!snapshot.exists()) {
        hasSnapshotRef.current.set(placeId, true)
        setHasSnapshot(true)
        setCounts({ wishlistCount: 0, favouriteCount: 0 })
        return
      }
      const data = snapshot.data()
      const nextCounts = {
        wishlistCount: typeof data?.wishlistCount === "number" ? data.wishlistCount : 0,
        favouriteCount: typeof data?.favouriteCount === "number" ? data.favouriteCount : 0,
      }
      hasSnapshotRef.current.set(placeId, true)
      setHasSnapshot(true)
      countsCacheRef.current.set(placeId, nextCounts)
      setCounts(nextCounts)
    })
    return unsubscribe
  }, [pin?.lat, pin?.lng, pin?.placeId, user?.uid])

  React.useEffect(() => {
    if (!pin || !transition) {
      lastTransitionRef.current = null
      return
    }
    const placeId = placeIdFromPin(pin)
    const transitionKey = `${placeId}:${transition.from ?? "none"}>${transition.to ?? "none"}`
    if (lastTransitionRef.current === transitionKey) return
    lastTransitionRef.current = transitionKey
    if (pendingWritesRef.current.get(placeId)) return
    const wishlistDelta =
      (transition.to === "wishlist" ? 1 : 0) - (transition.from === "wishlist" ? 1 : 0)
    const favouriteDelta =
      (transition.to === "favourite" ? 1 : 0) - (transition.from === "favourite" ? 1 : 0)
    const base = countsCacheRef.current.get(placeId) ?? counts
    const optimistic = {
      wishlistCount: Math.max(0, base.wishlistCount + wishlistDelta),
      favouriteCount: Math.max(0, base.favouriteCount + favouriteDelta),
    }
    countsCacheRef.current.set(placeId, optimistic)
    setCounts(optimistic)
  }, [counts, pin, transition])

  React.useEffect(() => {
    let active = true
    if (pin) {
      setFriends({ wishlistFriend: null, favouriteFriend: null })
      setFriendsResolved(false)
    }
    const load = async () => {
      if (!user?.uid || !pin) {
        if (active) {
          setFriends({ wishlistFriend: null, favouriteFriend: null })
          setFriendsResolved(true)
        }
        return
      }

      if (socialGraphLoading) {
        return
      }

      if (!relatedUserIds.length) {
        if (active) {
          setFriends({ wishlistFriend: null, favouriteFriend: null })
          setFriendsResolved(true)
        }
        return
      }

      const limitedFollowees = relatedUserIds.slice(0, MAX_FOLLOWEES_TO_CHECK)
      const placeId = placeIdFromPin(pin)
      const saveSnaps = await Promise.all(
        limitedFollowees.map((id) =>
          getDoc(
            doc(firestore, PLACE_STATS_COLLECTION, placeId, PLACE_USER_SAVES_SUBCOLLECTION, id)
          )
        )
      )

      const wishlistCandidates: Array<{ id: string; savedAt: number }> = []
      const favouriteCandidates: Array<{ id: string; savedAt: number }> = []
      saveSnaps.forEach((snapshot, index) => {
        if (!snapshot.exists()) return
        const data = snapshot.data() as { bucket?: string; savedAt?: unknown }
        const savedAt = toMillis(data.savedAt)
        const id = limitedFollowees[index]
        if (data.bucket === "wishlist") {
          wishlistCandidates.push({ id, savedAt })
        } else if (data.bucket === "favourite") {
          favouriteCandidates.push({ id, savedAt })
        }
      })

      const topWishlistId = pickLatest(wishlistCandidates)
      const topFavouriteId = pickLatest(favouriteCandidates)

      if (active) {
        const nextFriends = {
          wishlistFriend: topWishlistId
            ? {
                id: topWishlistId,
                label: formatUserLabel(relatedProfiles.get(topWishlistId) ?? null),
              }
            : null,
          favouriteFriend: topFavouriteId
            ? {
                id: topFavouriteId,
                label: formatUserLabel(relatedProfiles.get(topFavouriteId) ?? null),
              }
            : null,
        }
        friendsCacheRef.current.set(placeId, nextFriends)
        setFriends(nextFriends)
        setFriendsResolved(true)
      }
    }

    void load().catch((error) => {
      console.warn("Failed to load place engagement", error)
      if (active) {
        setFriends({ wishlistFriend: null, favouriteFriend: null })
        setFriendsResolved(true)
      }
    })

    return () => {
      active = false
    }
  }, [pin?.lat, pin?.lng, pin?.placeId, relatedProfiles, relatedUserIds, socialGraphLoading, user?.uid])

  return {
    wishlistCount: counts.wishlistCount,
    favouriteCount: counts.favouriteCount,
    wishlistFriend: friends.wishlistFriend,
    favouriteFriend: friends.favouriteFriend,
    hasSnapshot,
    friendsResolved,
  }
}

export default function PlaceSocialProof({
  pin,
  viewerBucket = null,
  transition = null,
  onTransitionSettled,
}: {
  pin: PlacePin | null
  viewerBucket?: "wishlist" | "favourite" | null
  transition?: { from: "wishlist" | "favourite" | "none" | null; to: "wishlist" | "favourite" | "none" | null } | null
  onTransitionSettled?: () => void
}) {
  const {
    wishlistCount,
    favouriteCount,
    wishlistFriend,
    favouriteFriend,
    hasSnapshot,
    friendsResolved,
  } = usePlaceEngagement(pin, transition)
  const transitionBaselineRef = React.useRef<{ wishlist: number; favourite: number } | null>(null)
  const displayTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDisplayAtRef = React.useRef(0)
  const incentiveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const friendGraceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [displayedLines, setDisplayedLines] = React.useState<ReturnType<typeof getSocialProofLines>["lines"]>([])
  const [displayedIncentive, setDisplayedIncentive] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (transition && !transitionBaselineRef.current) {
      transitionBaselineRef.current = {
        wishlist: wishlistCount,
        favourite: favouriteCount,
      }
      return
    }
    if (!transition) {
      transitionBaselineRef.current = null
    }
  }, [transition, wishlistCount, favouriteCount])

  React.useEffect(() => {
    if (!transition || !transitionBaselineRef.current || !onTransitionSettled) return
    const baseline = transitionBaselineRef.current
    const wishlistMoved = wishlistCount !== baseline.wishlist
    const favouriteMoved = favouriteCount !== baseline.favourite
    const movedAwayFromWishlist = transition.from === "wishlist" && wishlistCount < baseline.wishlist
    const movedAwayFromFavourite = transition.from === "favourite" && favouriteCount < baseline.favourite
    const movedIntoWishlist = transition.to === "wishlist" && wishlistCount > baseline.wishlist
    const movedIntoFavourite = transition.to === "favourite" && favouriteCount > baseline.favourite

    if (wishlistMoved || favouriteMoved || movedAwayFromWishlist || movedAwayFromFavourite || movedIntoWishlist || movedIntoFavourite) {
      onTransitionSettled()
    }
  }, [favouriteCount, onTransitionSettled, transition, wishlistCount])

  let displayWishlistCount = Math.max(0, wishlistCount)
  let displayFavouriteCount = Math.max(0, favouriteCount)
  const socialProof = React.useMemo(
    () =>
      getSocialProofLines({
        wishlistCount: displayWishlistCount,
        favouriteCount: displayFavouriteCount,
        wishlistFriendLabel: friendsResolved ? wishlistFriend?.label ?? null : null,
        favouriteFriendLabel: friendsResolved ? favouriteFriend?.label ?? null : null,
        selfBucket: viewerBucket ?? null,
      }),
    [
      displayFavouriteCount,
      displayWishlistCount,
      friendsResolved,
      favouriteFriend?.label,
      transition?.from,
      transition?.to,
      viewerBucket,
      wishlistFriend?.label,
    ]
  )

  React.useEffect(() => {
    return () => {
      if (displayTimerRef.current) {
        clearTimeout(displayTimerRef.current)
      }
      if (incentiveTimerRef.current) {
        clearTimeout(incentiveTimerRef.current)
      }
      if (friendGraceTimerRef.current) {
        clearTimeout(friendGraceTimerRef.current)
      }
    }
  }, [])

  React.useEffect(() => {
    if (!pin) {
      if (displayTimerRef.current) {
        clearTimeout(displayTimerRef.current)
      }
      if (incentiveTimerRef.current) {
        clearTimeout(incentiveTimerRef.current)
      }
      if (friendGraceTimerRef.current) {
        clearTimeout(friendGraceTimerRef.current)
      }
      setDisplayedLines([])
      setDisplayedIncentive(null)
      lastDisplayAtRef.current = 0
      return
    }

    const hasCounts = displayWishlistCount > 0 || displayFavouriteCount > 0
    const nextLines = socialProof.lines
    const readyForIncentive = hasSnapshot && friendsResolved && !transition && !hasCounts

    if (incentiveTimerRef.current) {
      clearTimeout(incentiveTimerRef.current)
      incentiveTimerRef.current = null
    }

    if (hasCounts) {
      const apply = () => {
        setDisplayedLines(nextLines)
        setDisplayedIncentive(null)
        lastDisplayAtRef.current = Date.now()
      }

      const shouldWaitForFriendLabels =
        !friendsResolved &&
        displayedLines.length === 0 &&
        !displayedIncentive &&
        !transition

      if (friendGraceTimerRef.current) {
        clearTimeout(friendGraceTimerRef.current)
        friendGraceTimerRef.current = null
      }
      if (shouldWaitForFriendLabels) {
        friendGraceTimerRef.current = setTimeout(apply, FRIEND_LABEL_GRACE_MS)
        return
      }

      const elapsed = Date.now() - lastDisplayAtRef.current
      const delay = displayedLines.length > 0 && elapsed < MIN_DISPLAY_MS ? MIN_DISPLAY_MS - elapsed : 0

      if (displayTimerRef.current) {
        clearTimeout(displayTimerRef.current)
      }
      if (delay > 0) {
        displayTimerRef.current = setTimeout(apply, delay)
      } else {
        apply()
      }
      return
    }

    if (displayTimerRef.current) {
      clearTimeout(displayTimerRef.current)
      displayTimerRef.current = null
    }
    if (friendGraceTimerRef.current) {
      clearTimeout(friendGraceTimerRef.current)
      friendGraceTimerRef.current = null
    }

    if (readyForIncentive) {
      incentiveTimerRef.current = setTimeout(() => {
        setDisplayedLines([])
        setDisplayedIncentive(socialProof.incentive)
        lastDisplayAtRef.current = Date.now()
      }, EMPTY_INCENTIVE_DELAY_MS)
    }
  }, [
    displayedLines.length,
    displayFavouriteCount,
    displayWishlistCount,
    friendsResolved,
    hasSnapshot,
    pin,
    socialProof.incentive,
    socialProof.lines,
    transition,
  ])

  if (!pin) {
    return null
  }

  if (!hasSnapshot && !transition && displayWishlistCount === 0 && displayFavouriteCount === 0) {
    return null
  }

  if (displayedIncentive) {
    return (
      <Text style={styles.incentive} numberOfLines={2}>
        {displayedIncentive}
      </Text>
    )
  }

  if (!displayedLines.length) {
    return null
  }

  return (
    <View style={styles.inline}>
      {displayedLines.map((line, index) => (
        <React.Fragment key={line.kind}>
          {index > 0 ? <Text style={styles.separator}>|</Text> : null}
          <View style={styles.inlineItem}>
            <View style={styles.iconWrapper}>
              <FontAwesome name="heart" size={12} color="#ef4444" />
              {line.kind === "favourite" ? <Text style={styles.sparkle}>✨</Text> : null}
            </View>
            <Text style={styles.inlineText} numberOfLines={1}>
              by {line.text}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  inline: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 8,
  },
  inlineItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconWrapper: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sparkle: {
    position: "absolute",
    right: -6,
    top: -6,
    fontSize: 10,
  },
  inlineText: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "500",
  },
  separator: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "600",
  },
  incentive: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "500",
  },
})
