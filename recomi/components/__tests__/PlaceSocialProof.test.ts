import { buildLineText, buildLineTextWithSelf, getSocialProofLines } from "../../shared/utils/socialProof"

describe("PlaceSocialProof helpers", () => {
  test("returns incentive when no saves exist", () => {
    const result = getSocialProofLines({
      wishlistCount: 0,
      favouriteCount: 0,
      wishlistFriendLabel: null,
      favouriteFriendLabel: null,
    })

    expect(result.lines).toHaveLength(0)
    expect(result.incentive).toBe("Be the first to save this spot.")
  })

  test("wishlist line uses friend label and omits 'others' when count is 1", () => {
    const result = getSocialProofLines({
      wishlistCount: 1,
      favouriteCount: 0,
      wishlistFriendLabel: "@topfriend",
      favouriteFriendLabel: null,
      selfBucket: null,
    })

    expect(result.incentive).toBeNull()
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toEqual({ kind: "wishlist", text: "@topfriend" })
  })

  test("wishlist line adds others when count > 1", () => {
    const result = getSocialProofLines({
      wishlistCount: 4,
      favouriteCount: 0,
      wishlistFriendLabel: "@topfriend",
      favouriteFriendLabel: null,
      selfBucket: null,
    })

    expect(result.lines[0]).toEqual({ kind: "wishlist", text: "@topfriend and 3 others" })
  })

  test("favourite line falls back to count when no friend label", () => {
    expect(
      buildLineText(1, null)
    ).toBe("1 person")
    expect(
      buildLineText(5, null)
    ).toBe("5 people")
  })

  test("shows both wishlist and favourite lines when counts exist", () => {
    const result = getSocialProofLines({
      wishlistCount: 2,
      favouriteCount: 1,
      wishlistFriendLabel: "@alex",
      favouriteFriendLabel: "@sam",
      selfBucket: null,
    })

    expect(result.lines).toEqual([
      { kind: "wishlist", text: "@alex and 1 other" },
      { kind: "favourite", text: "@sam" },
    ])
  })

  test("omits empty bucket lines", () => {
    const result = getSocialProofLines({
      wishlistCount: 0,
      favouriteCount: 3,
      wishlistFriendLabel: "@nope",
      favouriteFriendLabel: null,
      selfBucket: null,
    })

    expect(result.lines).toEqual([{ kind: "favourite", text: "3 people" }])
  })

  test("includes you when viewer saved in wishlist", () => {
    const result = getSocialProofLines({
      wishlistCount: 3,
      favouriteCount: 0,
      wishlistFriendLabel: "@june",
      favouriteFriendLabel: null,
      selfBucket: "wishlist",
    })

    expect(result.lines).toEqual([{ kind: "wishlist", text: "you, @june and 1 other" }])
  })

  test("formats self-only correctly", () => {
    expect(
      buildLineTextWithSelf({ count: 1, friendLabel: null, includeSelf: true })
    ).toBe("you")
  })
})
