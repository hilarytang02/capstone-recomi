import React from "react"
import { StyleSheet, Text, View } from "react-native"
import FontAwesome from "@expo/vector-icons/FontAwesome"
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore"

import { firestore } from "../shared/firebase/app"
import { useAuth } from "../shared/context/auth"
import { USER_FOLLOWS_COLLECTION, USERS_COLLECTION } from "../shared/api/users"
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
}

const MAX_FOLLOWEES_TO_CHECK = 50

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

const usePlaceEngagement = (pin: PlacePin | null): PlaceEngagement => {
  const { user } = useAuth()
  const [counts, setCounts] = React.useState({ wishlistCount: 0, favouriteCount: 0 })
  const [friends, setFriends] = React.useState<Pick<PlaceEngagement, "wishlistFriend" | "favouriteFriend">>({
    wishlistFriend: null,
    favouriteFriend: null,
  })

  React.useEffect(() => {
    if (!pin) {
      setCounts({ wishlistCount: 0, favouriteCount: 0 })
      return
    }

    const placeId = placeIdFromPin(pin)
    const ref = doc(firestore, PLACE_STATS_COLLECTION, placeId)
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (!snapshot.exists()) {
        setCounts({ wishlistCount: 0, favouriteCount: 0 })
        return
      }
      const data = snapshot.data()
      setCounts({
        wishlistCount: typeof data?.wishlistCount === "number" ? data.wishlistCount : 0,
        favouriteCount: typeof data?.favouriteCount === "number" ? data.favouriteCount : 0,
      })
    })
    return unsubscribe
  }, [pin?.lat, pin?.lng])

  React.useEffect(() => {
    let active = true
    const load = async () => {
      if (!user?.uid || !pin) {
        if (active) {
          setFriends({ wishlistFriend: null, favouriteFriend: null })
        }
        return
      }

      const followsSnapshot = await getDocs(
        query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followerId", "==", user.uid))
      )
      const followeeIds = followsSnapshot.docs
        .map((docSnap) => (docSnap.data() as { followeeId?: string }).followeeId)
        .filter((id): id is string => Boolean(id))
      if (!followeeIds.length) {
        if (active) {
          setFriends({ wishlistFriend: null, favouriteFriend: null })
        }
        return
      }

      const limitedFollowees = followeeIds.slice(0, MAX_FOLLOWEES_TO_CHECK)
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
      const idsToFetch = Array.from(new Set([topWishlistId, topFavouriteId].filter(Boolean)))

      const profiles = await Promise.all(
        idsToFetch.map(async (id) => {
          const profileSnap = await getDoc(doc(firestore, USERS_COLLECTION, id))
          return {
            id,
            label: profileSnap.exists()
              ? formatUserLabel(profileSnap.data() as { username?: string | null; displayName?: string | null })
              : "Someone",
          }
        })
      )
      const labelMap = new Map(profiles.map((profile) => [profile.id, profile.label]))

      if (active) {
        setFriends({
          wishlistFriend: topWishlistId ? { id: topWishlistId, label: labelMap.get(topWishlistId) ?? "Someone" } : null,
          favouriteFriend: topFavouriteId ? { id: topFavouriteId, label: labelMap.get(topFavouriteId) ?? "Someone" } : null,
        })
      }
    }

    void load().catch((error) => {
      console.warn("Failed to load place engagement", error)
      if (active) {
        setFriends({ wishlistFriend: null, favouriteFriend: null })
      }
    })

    return () => {
      active = false
    }
  }, [pin?.lat, pin?.lng, user?.uid])

  return {
    wishlistCount: counts.wishlistCount,
    favouriteCount: counts.favouriteCount,
    wishlistFriend: friends.wishlistFriend,
    favouriteFriend: friends.favouriteFriend,
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
  const { wishlistCount, favouriteCount, wishlistFriend, favouriteFriend } = usePlaceEngagement(pin)
  const transitionBaselineRef = React.useRef<{ wishlist: number; favourite: number } | null>(null)

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
  const wishlistDelta =
    (transition?.to === "wishlist" ? 1 : 0) - (transition?.from === "wishlist" ? 1 : 0)
  const favouriteDelta =
    (transition?.to === "favourite" ? 1 : 0) - (transition?.from === "favourite" ? 1 : 0)
  let displayWishlistCount = Math.max(0, wishlistCount + wishlistDelta)
  let displayFavouriteCount = Math.max(0, favouriteCount + favouriteDelta)
  if (transition?.from === "wishlist" && transition?.to !== "wishlist") {
    displayWishlistCount = 0
  }
  if (transition?.from === "favourite" && transition?.to !== "favourite") {
    displayFavouriteCount = 0
  }
  if (!transition && viewerBucket === "favourite" && wishlistCount <= 1) {
    displayWishlistCount = 0
  }
  if (!transition && viewerBucket === "wishlist" && favouriteCount <= 1) {
    displayFavouriteCount = 0
  }
  const { lines, incentive } = React.useMemo(
    () =>
      getSocialProofLines({
        wishlistCount: displayWishlistCount,
        favouriteCount: displayFavouriteCount,
        wishlistFriendLabel: wishlistFriend?.label ?? null,
        favouriteFriendLabel: favouriteFriend?.label ?? null,
        selfBucket: viewerBucket ?? null,
      }),
    [
      displayFavouriteCount,
      displayWishlistCount,
      favouriteFriend?.label,
      transition?.from,
      transition?.to,
      viewerBucket,
      wishlistFriend?.label,
    ]
  )

  if (!pin) {
    return null
  }

  if (incentive) {
    return (
      <Text style={styles.incentive} numberOfLines={2}>
        {incentive}
      </Text>
    )
  }

  return (
    <View style={styles.inline}>
      {lines.map((line, index) => (
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
