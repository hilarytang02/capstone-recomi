const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const DEFAULT_RADIUS_METERS = 30;

const getPlacesApiKey = () => process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

type PlacesLocation = { latitude: number; longitude: number };
type AddressComponent = { longText?: string; shortText?: string; types?: string[] };

export type PlaceLookupInput = {
  textQuery: string;
  location?: { lat: number; lng: number };
};

export type PlaceCandidate = {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  primaryType?: string;
  types?: string[];
  addressComponents?: AddressComponent[];
  formattedAddress?: string;
};

const mapCandidate = (place?: {
  id?: string;
  displayName?: { text?: string };
  location?: PlacesLocation;
  primaryType?: string;
  types?: string[];
  addressComponents?: AddressComponent[];
  formattedAddress?: string;
}) => {
  if (!place?.id || !place.location) return null;
  return {
    id: place.id,
    name: place.displayName?.text ?? "Unknown place",
    location: { lat: place.location.latitude, lng: place.location.longitude },
    primaryType: place.primaryType,
    types: place.types,
    addressComponents: place.addressComponents,
    formattedAddress: place.formattedAddress,
  } as PlaceCandidate;
};

export async function searchPlaceByText({ textQuery, location }: PlaceLookupInput) {
  const apiKey = getPlacesApiKey();
  if (!apiKey || !textQuery.trim()) return null;

  const body: Record<string, unknown> = {
    textQuery: textQuery.trim(),
  };

  if (location) {
    body.locationBias = {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: DEFAULT_RADIUS_METERS,
      },
    };
  }

  const response = await fetch(PLACES_SEARCH_TEXT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.primaryType,places.types,places.addressComponents,places.formattedAddress",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      location?: PlacesLocation;
      primaryType?: string;
      types?: string[];
      addressComponents?: AddressComponent[];
      formattedAddress?: string;
    }>;
  };
  return mapCandidate(data.places?.[0]) ?? null;
}

export async function searchNearbyPlace(location: { lat: number; lng: number }) {
  const apiKey = getPlacesApiKey();
  if (!apiKey) return null;

  const body = {
    locationRestriction: {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: DEFAULT_RADIUS_METERS,
      },
    },
    maxResultCount: 1,
    rankPreference: "DISTANCE",
  };

  const response = await fetch(PLACES_SEARCH_NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.primaryType,places.types,places.addressComponents,places.formattedAddress",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      location?: PlacesLocation;
      primaryType?: string;
      types?: string[];
      addressComponents?: AddressComponent[];
      formattedAddress?: string;
    }>;
  };
  return mapCandidate(data.places?.[0]) ?? null;
}

export async function searchNearbyPlaces(
  location: { lat: number; lng: number },
  opts?: { radiusMeters?: number; maxResultCount?: number }
) {
  const apiKey = getPlacesApiKey();
  if (!apiKey) return [];

  const body = {
    locationRestriction: {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: opts?.radiusMeters ?? DEFAULT_RADIUS_METERS,
      },
    },
    maxResultCount: opts?.maxResultCount ?? 20,
    rankPreference: "DISTANCE",
  };

  const response = await fetch(PLACES_SEARCH_NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.primaryType,places.types,places.addressComponents,places.formattedAddress",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return [];

  const data = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      location?: PlacesLocation;
      primaryType?: string;
      types?: string[];
      addressComponents?: AddressComponent[];
      formattedAddress?: string;
    }>;
  };
  return (data.places ?? []).map(mapCandidate).filter(Boolean) as PlaceCandidate[];
}
