jest.mock("../../firebase/app", () => ({
  firestore: {},
}))

jest.mock("../../context/auth", () => ({
  useAuth: () => ({
    user: null,
    initializing: false,
  }),
}))

jest.mock("../../context/socialGraph", () => ({
  useSocialGraph: () => ({
    relatedUserIds: [],
    relatedProfiles: new Map(),
    loading: false,
  }),
}))

import {
  applyPlaceEngagementTransition,
  buildMatchedProfiles,
  pickMatchedProfile,
} from "../usePlaceEngagement"

describe("usePlaceEngagement helpers", () => {
  const relatedProfiles = new Map([
    ["u1", { displayName: "User One", username: "userone", photoURL: null }],
    ["u2", { displayName: null, username: "usertwo", photoURL: "https://example.com/u2.png" }],
  ])

  test("applies wishlist to favourite transitions to counts", () => {
    const result = applyPlaceEngagementTransition(
      {
        wishlistCount: 3,
        favouriteCount: 1,
        recentSaverIds: ["u1"],
        recentWishlistSaverIds: ["u1"],
        recentFavouriteSaverIds: [],
      },
      { from: "wishlist", to: "favourite" }
    )

    expect(result).toMatchObject({
      wishlistCount: 2,
      favouriteCount: 2,
    })
  })

  test("returns the original state when the transition is unchanged", () => {
    const state = {
      wishlistCount: 1,
      favouriteCount: 2,
      recentSaverIds: ["u1"],
      recentWishlistSaverIds: [],
      recentFavouriteSaverIds: ["u1"],
    }

    expect(applyPlaceEngagementTransition(state, { from: "favourite", to: "favourite" })).toEqual(state)
    expect(applyPlaceEngagementTransition(state, null)).toEqual(state)
  })

  test("builds matched profiles in the same order as recent savers", () => {
    const result = buildMatchedProfiles({
      recentSaverIds: ["u3", "u2", "u1"],
      relatedUserIds: ["u2", "u1"],
      relatedProfiles,
    })

    expect(result).toEqual([
      { id: "u2", displayName: null, username: "usertwo", photoURL: "https://example.com/u2.png" },
      { id: "u1", displayName: "User One", username: "userone", photoURL: null },
    ])
  })

  test("returns an empty list when no related users intersect", () => {
    expect(
      buildMatchedProfiles({
        recentSaverIds: ["u3", "u4"],
        relatedUserIds: ["u1", "u2"],
        relatedProfiles,
      })
    ).toEqual([])
  })

  test("picks the first matching wishlist or favourite friend", () => {
    expect(
      pickMatchedProfile({
        saverIds: ["u3", "u2", "u1"],
        relatedUserIds: ["u1", "u2"],
        relatedProfiles,
      })
    ).toEqual({
      id: "u2",
      displayName: null,
      username: "usertwo",
      photoURL: "https://example.com/u2.png",
    })
  })

  test("returns null when no matching friend is available", () => {
    expect(
      pickMatchedProfile({
        saverIds: ["u3"],
        relatedUserIds: ["u1", "u2"],
        relatedProfiles,
      })
    ).toBeNull()
  })
})
