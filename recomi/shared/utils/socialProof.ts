export type SocialProofLine = {
  kind: "wishlist" | "favourite"
  text: string
}

export type SocialProofResult = {
  lines: SocialProofLine[]
  incentive: string | null
}

export const buildLineText = (count: number, friendLabel: string | null) => {
  if (friendLabel) {
    if (count <= 1) return friendLabel
    const remainder = count - 1
    return `${friendLabel} and ${remainder} ${remainder === 1 ? "other" : "others"}`
  }
  if (count === 1) return "1 person"
  return `${count} people`
}

export const buildLineTextWithSelf = ({
  count,
  friendLabel,
  includeSelf,
}: {
  count: number
  friendLabel: string | null
  includeSelf: boolean
}) => {
  const parts: string[] = []
  if (includeSelf) {
    parts.push("you")
  }
  if (friendLabel) {
    parts.push(friendLabel)
  }

  const remainder = count - (includeSelf ? 1 : 0) - (friendLabel ? 1 : 0)
  if (remainder > 0) {
    if (!parts.length) {
      return remainder === 1 ? "1 person" : `${remainder} people`
    }
    return `${parts.join(", ")} and ${remainder} ${remainder === 1 ? "other" : "others"}`
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`
  }
  if (parts.length === 1) {
    return parts[0]
  }

  return count === 1 ? "1 person" : `${count} people`
}

export const getSocialProofLines = ({
  wishlistCount,
  favouriteCount,
  wishlistFriendLabel,
  favouriteFriendLabel,
  selfBucket,
}: {
  wishlistCount: number
  favouriteCount: number
  wishlistFriendLabel: string | null
  favouriteFriendLabel: string | null
  selfBucket: "wishlist" | "favourite" | null
}): SocialProofResult => {
  const lines: SocialProofLine[] = []
  if (wishlistCount > 0) {
    lines.push({
      kind: "wishlist",
      text: buildLineTextWithSelf({
        count: wishlistCount,
        friendLabel: wishlistFriendLabel,
        includeSelf: selfBucket === "wishlist",
      }),
    })
  }
  if (favouriteCount > 0) {
    lines.push({
      kind: "favourite",
      text: buildLineTextWithSelf({
        count: favouriteCount,
        friendLabel: favouriteFriendLabel,
        includeSelf: selfBucket === "favourite",
      }),
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
