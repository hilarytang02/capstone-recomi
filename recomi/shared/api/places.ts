const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DEFAULT_RADIUS_METERS = 30;
const DEFAULT_AUTOCOMPLETE_RADIUS_METERS = 50000;

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

export type PlaceAutocompleteItem = {
  placeId: string;
  text: string;
  primaryText: string;
  secondaryText: string | null;
  distanceMeters?: number;
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

export async function searchPlaceAutocomplete({
  input,
  location,
}: {
  input: string;
  location?: { lat: number; lng: number };
}): Promise<PlaceAutocompleteItem[]> {
  const apiKey = getPlacesApiKey();
  if (!apiKey || !input.trim()) return [];

  const body: Record<string, unknown> = {
    input: input.trim(),
  };

  if (location) {
    body.locationBias = {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: DEFAULT_AUTOCOMPLETE_RADIUS_METERS,
      },
    };
    body.origin = {
      latitude: location.lat,
      longitude: location.lng,
    };
  }

  const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text,suggestions.placePrediction.distanceMeters",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return [];

  const data = (await response.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
        distanceMeters?: number;
      };
    }>;
  };

  return (data.suggestions ?? [])
    .map((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (!prediction?.placeId) return null;
      const text = prediction.text?.text ?? "";
      const primaryText = prediction.structuredFormat?.mainText?.text ?? text;
      const secondaryText = prediction.structuredFormat?.secondaryText?.text ?? null;
      return {
        placeId: prediction.placeId,
        text: text || primaryText,
        primaryText,
        secondaryText,
        distanceMeters: prediction.distanceMeters,
      } as PlaceAutocompleteItem;
    })
    .filter(Boolean) as PlaceAutocompleteItem[];
}
