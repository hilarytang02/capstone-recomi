import {
  RECENT_PLACE_SAVERS_LIMIT,
  updateRecentSaverIds,
} from "../placeStats"

describe("placeStats helpers", () => {
  test("adds a saver to the front of the list", () => {
    expect(updateRecentSaverIds(["u2", "u3"], "u1", true)).toEqual(["u1", "u2", "u3"])
  })

  test("deduplicates an existing saver before moving them to the front", () => {
    expect(updateRecentSaverIds(["u2", "u1", "u3"], "u1", true)).toEqual(["u1", "u2", "u3"])
  })

  test("removes a saver when include is false", () => {
    expect(updateRecentSaverIds(["u1", "u2", "u3"], "u2", false)).toEqual(["u1", "u3"])
  })

  test("returns an empty array when removing from an undefined list", () => {
    expect(updateRecentSaverIds(undefined, "u1", false)).toEqual([])
  })

  test("enforces the configured recent saver limit", () => {
    const existing = Array.from({ length: RECENT_PLACE_SAVERS_LIMIT }, (_, index) => `u${index + 1}`)

    const next = updateRecentSaverIds(existing, "new_user", true)

    expect(next).toHaveLength(RECENT_PLACE_SAVERS_LIMIT)
    expect(next[0]).toBe("new_user")
    expect(next).not.toContain(`u${RECENT_PLACE_SAVERS_LIMIT}`)
  })
})
