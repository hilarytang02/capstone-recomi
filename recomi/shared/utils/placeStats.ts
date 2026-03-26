export type PlacePin = {
  lat: number
  lng: number
  label?: string
  placeId?: string | null
}

export type PlaceBucket = "wishlist" | "favourite" | "none"
export type PlaceStatsDocument = {
  wishlistCount?: number
  favouriteCount?: number
  recentSaverIds?: string[]
  recentWishlistSaverIds?: string[]
  recentFavouriteSaverIds?: string[]
  lat?: number
  lng?: number
  label?: string | null
  placeId?: string | null
}

export const PLACE_STATS_COLLECTION = "placeStats"
export const PLACE_USER_SAVES_SUBCOLLECTION = "userSaves"
export const RECENT_PLACE_SAVERS_LIMIT = 24

const normalizeCoord = (value: number) => Number(value.toFixed(5))

export const normalizePin = (pin: PlacePin) => ({
  lat: normalizeCoord(pin.lat),
  lng: normalizeCoord(pin.lng),
  label: pin.label,
  placeId: pin.placeId ?? null,
})

export const placeIdFromPin = (pin: PlacePin) => {
  if (pin.placeId) return `g_${pin.placeId}`
  const normalized = normalizePin(pin)
  return `${normalized.lat.toFixed(5)}_${normalized.lng.toFixed(5)}`
}

export const coordsMatch = (a: PlacePin, b: PlacePin) => {
  if (a.placeId && b.placeId) {
    return a.placeId === b.placeId
  }
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5
}

export const updateRecentSaverIds = (
  current: string[] | undefined,
  uid: string,
  include: boolean,
  limit = RECENT_PLACE_SAVERS_LIMIT,
) => {
  const withoutUid = Array.isArray(current) ? current.filter((id) => id !== uid) : []
  if (!include) {
    return withoutUid
  }
  return [uid, ...withoutUid].slice(0, limit)
}
