export type PlacePin = {
  lat: number
  lng: number
  label?: string
  placeId?: string | null
}

export type PlaceBucket = "wishlist" | "favourite" | "none"

export const PLACE_STATS_COLLECTION = "placeStats"
export const PLACE_USER_SAVES_SUBCOLLECTION = "userSaves"

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
