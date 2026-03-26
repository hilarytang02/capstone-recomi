import React from "react"
import { StyleSheet, Text, View } from "react-native"
import FontAwesome from "@expo/vector-icons/FontAwesome"

import { usePlaceEngagement } from "../shared/hooks/usePlaceEngagement"
import { getSocialProofLines } from "../shared/utils/socialProof"
import type { PlacePin } from "../shared/utils/placeStats"

const MIN_DISPLAY_MS = 900
const EMPTY_INCENTIVE_DELAY_MS = 700
const FRIEND_LABEL_GRACE_MS = 350

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

  const socialProof = React.useMemo(
    () =>
      getSocialProofLines({
        wishlistCount: Math.max(0, wishlistCount),
        favouriteCount: Math.max(0, favouriteCount),
        wishlistFriendLabel: friendsResolved ? (wishlistFriend?.username ? `@${wishlistFriend.username}` : wishlistFriend?.displayName ?? null) : null,
        favouriteFriendLabel: friendsResolved ? (favouriteFriend?.username ? `@${favouriteFriend.username}` : favouriteFriend?.displayName ?? null) : null,
        selfBucket: viewerBucket ?? null,
      }),
    [
      favouriteCount,
      favouriteFriend?.displayName,
      favouriteFriend?.username,
      friendsResolved,
      viewerBucket,
      wishlistCount,
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
    if (!pin) {
      if (displayTimerRef.current) clearTimeout(displayTimerRef.current)
      if (incentiveTimerRef.current) clearTimeout(incentiveTimerRef.current)
      if (friendGraceTimerRef.current) clearTimeout(friendGraceTimerRef.current)
      setDisplayedLines([])
      setDisplayedIncentive(null)
      lastDisplayAtRef.current = 0
      return
    }

    const hasCounts = wishlistCount > 0 || favouriteCount > 0
    const readyForIncentive = hasSnapshot && friendsResolved && !transition && !hasCounts

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
        setDisplayedIncentive("Be the first to save this spot!")
        lastDisplayAtRef.current = Date.now()
      }, EMPTY_INCENTIVE_DELAY_MS)
    }
  }, [
    displayedIncentive,
    displayedLines.length,
    favouriteCount,
    friendsResolved,
    hasSnapshot,
    pin,
    socialProof.lines,
    transition,
    wishlistCount,
  ])

  if (!pin) return null
  if (!hasSnapshot && !transition && wishlistCount === 0 && favouriteCount === 0) {
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
