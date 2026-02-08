export type SocialProofLine = {
  kind: "wishlist" | "favourite"
  text: string
}

export type SocialProofResult = {
  lines: SocialProofLine[]
  incentive: string | null
}

export const buildLineText = (count: number, friendLabel: string | null, verb: string) => {
  if (friendLabel) {
    if (count <= 1) return friendLabel
    const remainder = count - 1
    return `${friendLabel} and ${remainder} ${remainder === 1 ? "other" : "others"}`
  }
  if (count === 1) return `1 person ${verb}`
  return `${count} people ${verb}`
}

export const getSocialProofLines = ({
  wishlistCount,
  favouriteCount,
  wishlistFriendLabel,
  favouriteFriendLabel,
}: {
  wishlistCount: number
  favouriteCount: number
  wishlistFriendLabel: string | null
  favouriteFriendLabel: string | null
}): SocialProofResult => {
  const lines: SocialProofLine[] = []
  if (wishlistCount > 0) {
    lines.push({
      kind: "wishlist",
      text: buildLineText(wishlistCount, wishlistFriendLabel, "saved"),
    })
  }
  if (favouriteCount > 0) {
    lines.push({
      kind: "favourite",
      text: buildLineText(favouriteCount, favouriteFriendLabel, "favourited"),
    })
  }
  if (!lines.length) {
    return {
      lines,
      incentive: "Be the first to save this spot.",
    }
  }
  return { lines, incentive: null }
}
