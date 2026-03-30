import React from "react"
import { StyleSheet, Text, View } from "react-native"
import FontAwesome from "@expo/vector-icons/FontAwesome"

import { usePlaceEngagement } from "../shared/hooks/usePlaceEngagement"
import { getSocialProofLines } from "../shared/utils/socialProof"
import type { PlacePin } from "../shared/utils/placeStats"

const MIN_DISPLAY_MS = 900
const FRIEND_LABEL_GRACE_MS = 350

const getDisplayCounts = ({
  wishlistCount,
  favouriteCount,
  transition,
  baseline,
}: {
  wishlistCount: number
  favouriteCount: number
  transition: { from: "wishlist" | "favourite" | "none" | null; to: "wishlist" | "favourite" | "none" | null } | null
  baseline: { wishlist: number; favourite: number } | null
}) => {
  if (!transition || !baseline) {
    return { wishlistCount, favouriteCount }
  }

  const expectedWishlist =
    baseline.wishlist +
    (transition.to === "wishlist" ? 1 : 0) -
    (transition.from === "wishlist" ? 1 : 0)
  const expectedFavourite =
    baseline.favourite +
    (transition.to === "favourite" ? 1 : 0) -
    (transition.from === "favourite" ? 1 : 0)

  return {
    wishlistCount:
      transition.to === "wishlist"
        ? Math.max(wishlistCount, expectedWishlist)
        : transition.from === "wishlist"
          ? Math.min(wishlistCount, expectedWishlist)
          : wishlistCount,
    favouriteCount:
      transition.to === "favourite"
        ? Math.max(favouriteCount, expectedFavourite)
        : transition.from === "favourite"
          ? Math.min(favouriteCount, expectedFavourite)
          : favouriteCount,
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
  const placeKey = React.useMemo(
    () => (pin ? (pin.placeId ? `g_${pin.placeId}` : `${pin.lat.toFixed(5)}_${pin.lng.toFixed(5)}`) : null),
    [pin]
  )

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

    if (
      wishlistMoved ||
      favouriteMoved ||
      movedAwayFromWishlist ||
      movedAwayFromFavourite ||
      movedIntoWishlist ||
      movedIntoFavourite
    ) {
      onTransitionSettled()
    }
  }, [favouriteCount, onTransitionSettled, transition, wishlistCount])

  const displayCounts = React.useMemo(
    () =>
      getDisplayCounts({
        wishlistCount,
        favouriteCount,
        transition,
        baseline:
          transitionBaselineRef.current ??
          (transition
            ? {
                wishlist: wishlistCount,
                favourite: favouriteCount,
              }
            : null),
      }),
    [favouriteCount, transition, wishlistCount]
  )

  const socialProof = React.useMemo(
    () =>
      getSocialProofLines({
        wishlistCount: Math.max(0, displayCounts.wishlistCount),
        favouriteCount: Math.max(0, displayCounts.favouriteCount),
        wishlistFriendLabel: friendsResolved ? (wishlistFriend?.username ? `@${wishlistFriend.username}` : wishlistFriend?.displayName ?? null) : null,
        favouriteFriendLabel: friendsResolved ? (favouriteFriend?.username ? `@${favouriteFriend.username}` : favouriteFriend?.displayName ?? null) : null,
        selfBucket: viewerBucket ?? null,
      }),
    [
      displayCounts.favouriteCount,
      displayCounts.wishlistCount,
      favouriteFriend?.displayName,
      favouriteFriend?.username,
      friendsResolved,
      viewerBucket,
      wishlistFriend?.displayName,
      wishlistFriend?.username,
    ]
  )

  React.useEffect(() => {
    return () => {
      if (displayTimerRef.current) clearTimeout(displayTimerRef.current)
      if (incentiveTimerRef.current) clearTimeout(incentiveTimerRef.current)
      if (friendGraceTimerRef.current) clearTimeout(friendGraceTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (displayTimerRef.current) clearTimeout(displayTimerRef.current)
    if (incentiveTimerRef.current) clearTimeout(incentiveTimerRef.current)
    if (friendGraceTimerRef.current) clearTimeout(friendGraceTimerRef.current)
    setDisplayedLines([])
    setDisplayedIncentive(null)
    lastDisplayAtRef.current = 0
  }, [placeKey])

  React.useEffect(() => {
    if (!pin) {
      if (displayTimerRef.current) clearTimeout(displayTimerRef.current)
      if (incentiveTimerRef.current) clearTimeout(incentiveTimerRef.current)
      if (friendGraceTimerRef.current) clearTimeout(friendGraceTimerRef.current)
      setDisplayedLines([])
      setDisplayedIncentive(null)
      lastDisplayAtRef.current = 0
      return
    }

    const hasCounts = displayCounts.wishlistCount > 0 || displayCounts.favouriteCount > 0
    const transitioningToEmpty =
      !hasCounts &&
      transition?.to === "none" &&
      transition.from != null &&
      transition.from !== "none"
    const readyForIncentive =
      hasSnapshot &&
      friendsResolved &&
      !hasCounts &&
      (!transition || transitioningToEmpty)

    if (incentiveTimerRef.current) {
      clearTimeout(incentiveTimerRef.current)
      incentiveTimerRef.current = null
    }

    if (hasCounts) {
      const apply = () => {
        setDisplayedLines(socialProof.lines)
        setDisplayedIncentive(null)
        lastDisplayAtRef.current = Date.now()
      }

      const shouldWaitForFriendLabels =
        !friendsResolved &&
        displayedLines.length === 0 &&
        !displayedIncentive &&
        !transition
      const shouldBypassDisplayHold =
        Boolean(transition)

      if (friendGraceTimerRef.current) {
        clearTimeout(friendGraceTimerRef.current)
        friendGraceTimerRef.current = null
      }
      if (shouldWaitForFriendLabels) {
        friendGraceTimerRef.current = setTimeout(apply, FRIEND_LABEL_GRACE_MS)
        return
      }

      const elapsed = Date.now() - lastDisplayAtRef.current
      const delay =
        !shouldBypassDisplayHold && displayedLines.length > 0 && elapsed < MIN_DISPLAY_MS
          ? MIN_DISPLAY_MS - elapsed
          : 0

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

    setDisplayedLines([])
    setDisplayedIncentive(null)

    if (readyForIncentive) {
      setDisplayedIncentive("Be the first to save this spot!")
      lastDisplayAtRef.current = Date.now()
    }
  }, [
    displayedIncentive,
    displayedLines.length,
    displayCounts.favouriteCount,
    displayCounts.wishlistCount,
    friendsResolved,
    hasSnapshot,
    pin,
    socialProof.lines,
    transition,
  ])

  if (!pin) return null
  if (!hasSnapshot && !transition && displayCounts.wishlistCount === 0 && displayCounts.favouriteCount === 0) {
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
