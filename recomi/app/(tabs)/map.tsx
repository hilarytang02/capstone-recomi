import React from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "../../components/MapView";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Camera } from "react-native-maps";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { addDoc, collection, doc, getDoc, getDocs, query as firestoreQuery, serverTimestamp, where } from "firebase/firestore";
import { searchNearbyPlace, searchNearbyPlaces, searchPlaceAutocomplete, searchPlaceByText, type PlaceAutocompleteItem } from "../../shared/api/places";
import {
  useSavedLists,
  type SavedEntry,
  type SavedListDefinition,
  LIST_VISIBILITY_OPTIONS,
} from "../../shared/context/savedLists";
import PlaceSocialProof from "../../components/PlaceSocialProof";
import { useAuth } from "../../shared/context/auth";
import { firestore } from "../../shared/firebase/app";
import { USER_FOLLOWS_COLLECTION, USERS_COLLECTION } from "../../shared/api/users";
import { PLACE_STATS_COLLECTION, PLACE_USER_SAVES_SUBCOLLECTION, placeIdFromPin } from "../../shared/utils/placeStats";

const WORLD: Region = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 80,     // big deltas = zoomed out
  longitudeDelta: 180,
};
const STREET_DELTA = 0.0025; // tighter zoom for block-level view
const SHEET_LAT_OFFSET_FACTOR = 0.38; // push map center upward when sheet is visible

type SheetState = "hidden" | "collapsed" | "half" | "expanded";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHTS: Record<SheetState, number> = {
  hidden: 0,
  collapsed: Math.max(SCREEN_HEIGHT * 0.12, 110),
  half: SCREEN_HEIGHT * 0.5,
  expanded: Math.min(SCREEN_HEIGHT * 0.82, SCREEN_HEIGHT - 96),
};

const OFFSET_BY_SHEET: Record<SheetState, number> = {
  hidden: 0,
  collapsed: 0,
  half: 0.18,
  expanded: SHEET_LAT_OFFSET_FACTOR,
};

const makeRegion = (
  latitude: number,
  longitude: number,
  delta = STREET_DELTA,
  offsetFactor = 0
): Region => ({
  latitude: latitude - delta * offsetFactor,
  longitude,
  latitudeDelta: delta,
  longitudeDelta: delta,
});

type PinData = {
  lat: number;
  lng: number;
  label: string;
  placeId?: string | null;
};

type TenantCandidate = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  placeId: string;
  floorLabel: string;
};

type ListBucket = "none" | "wishlist" | "favourite";

type SocialSaver = {
  id: string;
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
};

const buildLabel = (place: any, fallback: string) => {
  if (!place) return fallback;
  const primary =
    place.name ??
    place.street ??
    place.streetName ??
    place.address ??
    place.subThoroughfare ??
    place.district;
  const secondary = place.city ?? place.subregion ?? place.region ?? place.postalCode;
  const label = [primary, secondary].filter(Boolean).join(", ");
  return label || fallback;
};

const coordsMatch = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

// Combines search, map camera control, and list-saving UX into the home screen.
export default function MapScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const mapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const [region, setRegion] = React.useState<Region>(WORLD);
  const [locPerm, setLocPerm] = React.useState<"granted" | "denied" | "undetermined">("undetermined");
  const [query, setQuery] = React.useState("");
  const searchInputRef = React.useRef<TextInput | null>(null);
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [searchSuggestions, setSearchSuggestions] = React.useState<PlaceAutocompleteItem[]>([]);
  const [searchSuggesting, setSearchSuggesting] = React.useState(false);
  const latestSuggestRequestRef = React.useRef(0);
  const [pin, setPin] = React.useState<PinData | null>(null);
  const [userCoords, setUserCoords] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [sheetState, setSheetState] = React.useState<SheetState>("hidden");
  const [listModalVisible, setListModalVisible] = React.useState(false);
  const { addEntry, entries, removeEntry, lists, addList, mapFocusEntry, clearMapFocus } = useSavedLists();
  const [pinSaveStatus, setPinSaveStatus] = React.useState<"wishlist" | "favourite" | null>(null);
  const [pinSaveTransition, setPinSaveTransition] = React.useState<{
    from: "wishlist" | "favourite" | "none" | null;
    to: "wishlist" | "favourite" | "none" | null;
  } | null>(null);
  const [heading, setHeading] = React.useState(0);
  const [cameraInfo, setCameraInfo] = React.useState<Camera | null>(null);
  const [bulkMovePrompt, setBulkMovePrompt] = React.useState<{
    primaryListId: string;
    primaryListName: string;
    wishlistListIds: string[];
    locationLabel: string;
  } | null>(null);
  const latestPinRequestRef = React.useRef(0);
  const lastTapAtRef = React.useRef(0);
  const [tenantPickerVisible, setTenantPickerVisible] = React.useState(false);
  const [tenantCandidates, setTenantCandidates] = React.useState<TenantCandidate[]>([]);
  const [tenantFloors, setTenantFloors] = React.useState<string[]>([]);
  const [tenantFloor, setTenantFloor] = React.useState<string | null>(null);
  const [tenantAnchor, setTenantAnchor] = React.useState<{ lat: number; lng: number } | null>(null);
  const tenantPickerHidden = sheetState === "expanded";
  const [socialListOpen, setSocialListOpen] = React.useState(false);
  const [socialSavers, setSocialSavers] = React.useState<SocialSaver[]>([]);
  const [inviteModalOpen, setInviteModalOpen] = React.useState(false);
  const [inviteTarget, setInviteTarget] = React.useState<SocialSaver | null>(null);
  const [inviteMessage, setInviteMessage] = React.useState("");
  const [initialListStates, setInitialListStates] = React.useState<Record<string, ListBucket>>({});
  const [pendingListStates, setPendingListStates] = React.useState<Record<string, ListBucket>>({});
  const [newListModalVisible, setNewListModalVisible] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const [newListError, setNewListError] = React.useState<string | null>(null);
  const [newListVisibility, setNewListVisibility] = React.useState<SavedListDefinition["visibility"]>("public");
  const reopenListModalRef = React.useRef(false);

  const locationLabel = pin?.label ?? "this place";
  const bulkMoveListNames = React.useMemo(() => {
    if (!bulkMovePrompt) return [];
    return bulkMovePrompt.wishlistListIds
      .map((id) => lists.find((list) => list.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  }, [bulkMovePrompt, lists]);
  const bulkMoveDisplayNames = React.useMemo(
    () => bulkMoveListNames.slice(0, 3),
    [bulkMoveListNames]
  );
  const bulkMoveShowEtc = bulkMoveListNames.length > 3;

  React.useEffect(() => {
    if (listModalVisible) {
      setPendingListStates(initialListStates);
      setBulkMovePrompt(null);
    }
  }, [initialListStates, listModalVisible]);

  const resolvePlaceId = React.useCallback(
    async (label: string, coords: { lat: number; lng: number }) => {
      if (!label || label === "Dropped pin") return null;
      const result = await searchPlaceByText({ textQuery: label, location: coords });
      return result?.id ?? null;
    },
    []
  );

  const pinMatches = React.useCallback((a: PinData, b: PinData) => {
    if (a.placeId && b.placeId) {
      return a.placeId === b.placeId;
    }
    return Math.abs(a.lat - b.lat) < 1e-8 && Math.abs(a.lng - b.lng) < 1e-8;
  }, []);

  const getAddressPart = (components: any[] | undefined, type: string) =>
    components?.find((part) => Array.isArray(part?.types) && part.types.includes(type))?.longText ??
    components?.find((part) => Array.isArray(part?.types) && part.types.includes(type))?.shortText ??
    null;

  const getAddressKey = (components?: any[]) => {
    const streetNumber = getAddressPart(components, "street_number");
    const route = getAddressPart(components, "route");
    if (!streetNumber || !route) return null;
    return `${streetNumber} ${route}`.toLowerCase();
  };

  const floorNumberFromShop = (raw: string) => {
    const digits = (raw.match(/\d+/g) || []).join("");
    if (!digits) return null;
    if (digits.length <= 2) return parseInt(digits, 10);
    const floorDigits = digits.slice(0, digits.length - 2);
    return parseInt(floorDigits, 10);
  };

  const normalizeFloorLabel = (raw: string | null) => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^g\/f$/i.test(trimmed)) return "G/F";
    const floorMatch = trimmed.match(/\b(\d+)\s*\/\s*f\b/i);
    if (floorMatch?.[1]) return `${floorMatch[1]}/F`;
    const levelMatch = trimmed.match(/\b(floor|fl|lvl|level)\s*([0-9]+)\b/i);
    if (levelMatch?.[2]) return `${levelMatch[2]}/F`;
    return trimmed;
  };

  const getFloorLabel = (components?: any[], formattedAddress?: string | null) => {
    const floor = normalizeFloorLabel(getAddressPart(components, "floor"));
    if (floor) return floor;
    const subpremise = getAddressPart(components, "subpremise");
    if (subpremise) {
      const normalized = normalizeFloorLabel(subpremise);
      if (normalized) return normalized;
      const inferred = floorNumberFromShop(subpremise);
      if (typeof inferred === "number" && !Number.isNaN(inferred)) {
        return inferred === 0 ? "G/F" : `${inferred}/F`;
      }
      return subpremise;
    }
    if (!formattedAddress) return "Other";
    const match = formattedAddress.match(/\b(floor|fl|lvl|level)\s*([0-9]+)\b/i);
    if (match?.[2]) return `${match[2]}/F`;
    return "Other";
  };

  const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const isBuildingCentered = React.useCallback(
    (coords: { lat: number; lng: number }) => {
      if (!region) return false;
      if (region.latitudeDelta > 0.001) return false;
      const distance = metersBetween(coords, { lat: region.latitude, lng: region.longitude });
      return distance <= 5;
    },
    [region]
  );

  const BUILDING_TYPES = React.useMemo(
    () =>
      new Set([
        "shopping_mall",
        "premise",
        "subpremise",
        "establishment",
        "department_store",
      ]),
    []
  );

  const loadTenantsForPlace = React.useCallback(
    async (place: any) => {
      const addressKey = getAddressKey(place.addressComponents);
      if (!addressKey) return false;

      const nearby = await searchNearbyPlaces(
        { lat: place.location.lat, lng: place.location.lng },
        { radiusMeters: 150, maxResultCount: 50 }
      );

      const sameAddress = nearby.filter((candidate) => {
        const key = getAddressKey(candidate.addressComponents as any[]);
        return key && key === addressKey;
      });

      if (sameAddress.length < 2) return false;

      const candidates = sameAddress.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        lat: candidate.location.lat,
        lng: candidate.location.lng,
        placeId: candidate.id,
        floorLabel: getFloorLabel(candidate.addressComponents as any[], candidate.formattedAddress),
      }));

      const floors = Array.from(new Set(candidates.map((c) => c.floorLabel)));
      const floorValue = (label: string) => {
        if (label === "Other") return Number.POSITIVE_INFINITY;
        if (label === "G/F") return 0;
        const match = label.match(/(\d+)/);
        if (match?.[1]) return parseInt(match[1], 10);
        return Number.POSITIVE_INFINITY - 1;
      };
      const sortedFloors = floors.sort((a, b) => floorValue(a) - floorValue(b));
      setTenantCandidates(candidates);
      setTenantFloors(sortedFloors);
      setTenantFloor(sortedFloors[0] ?? null);
      setTenantAnchor({ lat: place.location.lat, lng: place.location.lng });
      if (isBuildingCentered({ lat: place.location.lat, lng: place.location.lng })) {
        setTenantPickerVisible(true);
      }
      return true;
    },
    [BUILDING_TYPES, isBuildingCentered]
  );

  React.useEffect(() => {
    if (!pin) {
      setPinSaveStatus(null);
      setInitialListStates({});
      setPendingListStates({});
      return;
    }

    const matches = entries.filter((entry) => pinMatches(entry.pin, pin));

    const nextInitial: Record<string, ListBucket> = {};
    lists.forEach((list) => {
      const match = matches.find((entry) => entry.listId === list.id);
      nextInitial[list.id] = match?.bucket ?? "none";
    });
    setInitialListStates(nextInitial);
    setPendingListStates(nextInitial);

    if (matches.some((entry) => entry.bucket === "favourite")) {
      setPinSaveStatus("favourite");
    } else if (matches.some((entry) => entry.bucket === "wishlist")) {
      setPinSaveStatus("wishlist");
    } else {
      setPinSaveStatus(null);
    }
  }, [entries, pin, lists]);

  React.useEffect(() => {
    setPinSaveTransition(null);
  }, [pin?.lat, pin?.lng]);

  // Seed geolocation permission status so we know whether to show prompts later.
  React.useEffect(() => {
    // Prime local state without prompting; fetchUserLocation will handle requests.
    Location.getForegroundPermissionsAsync().then(({ status }) => setLocPerm(status));
  }, []);

  // Convenience wrapper around MapView.animateToRegion.
  const animateTo = React.useCallback(
    (r: Region, ms = 800) => mapRef.current?.animateToRegion(r, ms),
    []
  );

  // Central place to keep region + sheet state in sync when focusing coordinates.
  const focusOn = React.useCallback(
    (
      latitude: number,
      longitude: number,
      opts?: { delta?: number; targetSheet?: SheetState; animateMs?: number }
    ) => {
      const delta = opts?.delta ?? STREET_DELTA;
      const targetSheet = opts?.targetSheet ?? sheetState;
      const offsetFactor = OFFSET_BY_SHEET[targetSheet];
      const nextRegion = makeRegion(latitude, longitude, delta, offsetFactor);
      setRegion(nextRegion);
      animateTo(nextRegion, opts?.animateMs);
      setHeading(0);
      return nextRegion;
    },
    [animateTo, sheetState]
  );

  React.useEffect(() => {
    if (!isFocused) return;
    if (!mapFocusEntry) return;

    const { pin: entryPin } = mapFocusEntry;
    setListModalVisible(false);
    setBulkMovePrompt(null);
    setQuery("");
    setSheetState("half");
    setPin({ lat: entryPin.lat, lng: entryPin.lng, label: entryPin.label });
    focusOn(entryPin.lat, entryPin.lng, { targetSheet: "half", animateMs: 600 });
    clearMapFocus();
  }, [clearMapFocus, focusOn, isFocused, mapFocusEntry]);

  // Request foreground location and center the map; reused for "center me" button + initial load.
  const fetchUserLocation = React.useCallback(
    async (animate = true) => {
      try {
        let status = locPerm;
        if (status !== "granted") {
          const permission = await Location.requestForegroundPermissionsAsync();
          status = permission.status;
          setLocPerm(status);
          if (status !== "granted") return null;
        }

        const { coords } = await Location.getCurrentPositionAsync({});
        const nextRegion = focusOn(coords.latitude, coords.longitude, {
          targetSheet: sheetState,
          animateMs: animate ? 800 : 0,
        });
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
        return nextRegion;
      } catch (err) {
        console.warn("Location lookup failed:", err);
        return null;
      }
    },
    [focusOn, locPerm, sheetState]
  );

  const goToMyLocation = React.useCallback(() => {
    setPin(null);
    setSheetState("hidden");
    setPinSaveStatus(null);
    setListModalVisible(false);
    setBulkMovePrompt(null);
    void fetchUserLocation(true);
  }, [fetchUserLocation]);

  React.useEffect(() => {
    void fetchUserLocation(true);
    // We intentionally ignore dependency warnings so closing the sheet does not re-trigger centering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text search entry point that geocodes arbitrary strings into pins.
  const handleSubmit = async (raw?: string) => {
    const trimmed = (raw ?? query).trim();
    setSearchSuggestions([]);
    setSearchSuggesting(false);
    if (!trimmed) {
      setPin(null);
      setSheetState("hidden");
      setPinSaveStatus(null);
      setListModalVisible(false);
      setBulkMovePrompt(null);
      return;
    }

    try {
      const requestId = ++latestPinRequestRef.current;
      let nextLat = 0;
      let nextLng = 0;
      const place = await searchPlaceByText({
        textQuery: trimmed,
        location: userCoords ? { lat: userCoords.latitude, lng: userCoords.longitude } : undefined,
      });

      if (latestPinRequestRef.current !== requestId) return;

      if (place) {
        nextLat = place.location.lat;
        nextLng = place.location.lng;
        const isBuilding =
          BUILDING_TYPES.has(place.primaryType ?? "") ||
          (place.types ?? []).some((type) => BUILDING_TYPES.has(type));
        if (isBuilding) {
          const handled = await loadTenantsForPlace(place);
          if (handled) {
            setPin({ lat: place.location.lat, lng: place.location.lng, label: place.name, placeId: place.id });
            return;
          }
        }
        setPin({ lat: place.location.lat, lng: place.location.lng, label: place.name, placeId: place.id });
      } else {
        const results = await Location.geocodeAsync(trimmed);
        const match = results[0];
        if (!match) return;
        const { latitude, longitude } = match;
        nextLat = latitude;
        nextLng = longitude;
        const label = buildLabel(match, trimmed);
        const placeId = await resolvePlaceId(label, { lat: latitude, lng: longitude });
        setPin({ lat: latitude, lng: longitude, label, placeId });
      }
      setSheetState("half");
      focusOn(nextLat, nextLng, { targetSheet: "half" });
      setPinSaveStatus(null);
      setBulkMovePrompt(null);
    } catch (err) {
      console.warn("Geocoding failed:", err);
    }
  };

  // Supports long-press/double-tap interactions by dropping pins directly on the map.
  const handleMapPress = ({ latitude, longitude }: { latitude: number; longitude: number }) => {
    dismissKeyboard();
    const now = Date.now();
    if (now - lastTapAtRef.current < 200) return;
    lastTapAtRef.current = now;
    const requestId = ++latestPinRequestRef.current;
    const basePin: PinData = { lat: latitude, lng: longitude, label: "Dropped pin" };
    setPin(basePin);
    setQuery("");
    setSheetState("half");
    focusOn(latitude, longitude, { targetSheet: "half" });
    setPinSaveStatus(null);
    setBulkMovePrompt(null);

    void searchNearbyPlace({ lat: latitude, lng: longitude })
      .then(async (place) => {
        if (latestPinRequestRef.current !== requestId) return;
        if (place) {
          const isBuilding =
            BUILDING_TYPES.has(place.primaryType ?? "") ||
            (place.types ?? []).some((type) => BUILDING_TYPES.has(type));
          if (isBuilding) {
            const handled = await loadTenantsForPlace(place);
            if (handled) {
              setPin({ lat: place.location.lat, lng: place.location.lng, label: place.name, placeId: place.id });
              return;
            }
          }
          setPin({ lat: place.location.lat, lng: place.location.lng, label: place.name, placeId: place.id });
          return;
        }

        const results = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (latestPinRequestRef.current !== requestId) return;
        const name = buildLabel(results?.[0], basePin.label);
        const placeId = await resolvePlaceId(name, { lat: latitude, lng: longitude });
        if (latestPinRequestRef.current !== requestId) return;
        setPin({ lat: latitude, lng: longitude, label: name, placeId });
      })
      .catch((err) => {
        console.warn("Reverse geocode failed:", err);
      });
  };

  const handlePoiPress = (event: any) => {
    const { coordinate, name, placeId } = event?.nativeEvent ?? {};
    if (!coordinate?.latitude || !coordinate?.longitude) return;
    dismissKeyboard();
    const now = Date.now();
    if (now - lastTapAtRef.current < 200) return;
    lastTapAtRef.current = now;
    const requestId = ++latestPinRequestRef.current;
    const fallbackLabel = typeof name === "string" && name.trim() ? name : "Selected place";
    void searchPlaceByText({
      textQuery: fallbackLabel,
      location: { lat: coordinate.latitude, lng: coordinate.longitude },
    }).then(async (place) => {
      if (latestPinRequestRef.current !== requestId) return;
      if (place) {
        const isBuilding =
          BUILDING_TYPES.has(place.primaryType ?? "") ||
          (place.types ?? []).some((type) => BUILDING_TYPES.has(type));
        if (isBuilding) {
          const handled = await loadTenantsForPlace(place);
          if (handled) {
            setPin({ lat: place.location.lat, lng: place.location.lng, label: place.name, placeId: place.id });
            return;
          }
        }
        setPin({ lat: place.location.lat, lng: place.location.lng, label: place.name, placeId: place.id });
      } else {
        setPin({
          lat: coordinate.latitude,
          lng: coordinate.longitude,
          label: fallbackLabel,
          placeId: typeof placeId === "string" ? placeId : null,
        });
      }
    });
    setQuery("");
    setSheetState("half");
    focusOn(coordinate.latitude, coordinate.longitude, { targetSheet: "half" });
    setPinSaveStatus(null);
    setBulkMovePrompt(null);
  };

  const visibleTenants = React.useMemo(() => {
    if (!tenantFloor) return tenantCandidates;
    return tenantCandidates.filter((candidate) => candidate.floorLabel === tenantFloor);
  }, [tenantCandidates, tenantFloor]);

  React.useEffect(() => {
    if (!tenantPickerVisible || !tenantAnchor) return;
    if (!isBuildingCentered(tenantAnchor)) {
      setTenantPickerVisible(false);
    }
  }, [isBuildingCentered, tenantAnchor, tenantPickerVisible]);

  const tenantPickerStyle = React.useMemo(() => {
    const maxHeight = sheetState === "half" ? "40%" : "48%";
    const recenterStack = 240;
    const bottomOffset =
      sheetState === "half" ? sheetHeight + 16 : insets.bottom + 24 + recenterStack;
    const rightInset = sheetState === "half" ? 16 : 160;
    return { top: insets.top + 72, bottom: bottomOffset, maxHeight, right: rightInset };
  }, [insets.bottom, insets.top, sheetHeight, sheetState]);

  const handleTenantSelect = (tenant: TenantCandidate) => {
    setTenantPickerVisible(false);
    setPin({
      lat: tenant.lat,
      lng: tenant.lng,
      label: tenant.name,
      placeId: tenant.placeId,
    });
    setSheetState("half");
    focusOn(tenant.lat, tenant.lng, { targetSheet: "half" });
  };

  const defaultInviteMessage = React.useMemo(() => {
    if (!inviteTarget) return "";
    const name = inviteTarget.displayName ?? (inviteTarget.username ? `@${inviteTarget.username}` : "there");
    const placeLabel = pin?.label ?? "this place";
    return `Hey ${name}, want to go to ${placeLabel} together?`;
  }, [inviteTarget, pin?.label]);

  const sendInvite = React.useCallback(async () => {
    if (!user?.uid || !inviteTarget || !pin) return;
    const message = inviteMessage.trim() || defaultInviteMessage;
    try {
      await addDoc(collection(firestore, "invites"), {
        fromUserId: user.uid,
        toUserId: inviteTarget.id,
        placeId: placeIdFromPin(pin),
        placeLabel: pin.label ?? "this place",
        message,
        status: "sent",
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("Failed to send invite", error);
    }
    setInviteModalOpen(false);
  }, [defaultInviteMessage, inviteMessage, inviteTarget, pin, user?.uid]);

  React.useEffect(() => {
    const load = async () => {
      if (!pin || !user?.uid) {
        setSocialSavers([]);
        return;
      }
      if (!socialListOpen && !pinSaveStatus) {
        setSocialSavers([]);
        return;
      }
      const placeId = placeIdFromPin(pin);
      const followsSnapshot = await getDocs(
        firestoreQuery(collection(firestore, USER_FOLLOWS_COLLECTION), where("followerId", "==", user.uid))
      );
      const followerSnapshot = await getDocs(
        firestoreQuery(collection(firestore, USER_FOLLOWS_COLLECTION), where("followeeId", "==", user.uid))
      );
      const followees = followsSnapshot.docs
        .map((docSnap) => (docSnap.data() as { followeeId?: string }).followeeId)
        .filter((id): id is string => Boolean(id));
      const followers = followerSnapshot.docs
        .map((docSnap) => (docSnap.data() as { followerId?: string }).followerId)
        .filter((id): id is string => Boolean(id));
      const orderedIds = [...followees, ...followers.filter((id) => !followees.includes(id))];
      if (!orderedIds.length) {
        setSocialSavers([]);
        return;
      }
      const saveSnaps = await Promise.all(
        orderedIds.map((id) =>
          getDoc(doc(firestore, PLACE_STATS_COLLECTION, placeId, PLACE_USER_SAVES_SUBCOLLECTION, id))
        )
      );
      const savedIds = orderedIds.filter((_, index) => saveSnaps[index].exists());
      if (!savedIds.length) {
        setSocialSavers([]);
        return;
      }
      const profiles = await Promise.all(
        savedIds.map(async (id) => {
          const profileSnap = await getDoc(doc(firestore, USERS_COLLECTION, id));
          const data = profileSnap.exists()
            ? (profileSnap.data() as { displayName?: string | null; username?: string | null; photoURL?: string | null })
            : {};
          return {
            id,
            displayName: data.displayName ?? null,
            username: data.username ?? null,
            photoURL: data.photoURL ?? null,
          } as SocialSaver;
        })
      );
      const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
      profiles.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
      setSocialSavers(profiles);
    };
    void load().catch((error) => {
      console.warn("Failed to load social savers", error);
      setSocialSavers([]);
    });
  }, [pin, pinSaveStatus, socialListOpen, user?.uid]);

  // Reset camera heading to north when the compass button is tapped.
  const handleCompassPress = React.useCallback(() => {
    if (!mapRef.current) return;

    if (cameraInfo && mapRef.current.animateCamera) {
      mapRef.current.animateCamera(
        {
          ...cameraInfo,
          heading: 0,
        },
        { duration: 300 }
      );
    } else if (mapRef.current.animateCamera) {
      const fallbackCamera: Camera = {
        center: {
          latitude: region.latitude,
          longitude: region.longitude,
        },
        heading: 0,
        pitch: 0,
        altitude: cameraInfo?.altitude ?? 1000,
        zoom: cameraInfo?.zoom,
      };
      mapRef.current.animateCamera(fallbackCamera, { duration: 300 });
    } else if (mapRef.current.animateToRegion) {
      mapRef.current.animateToRegion(
        makeRegion(region.latitude, region.longitude, region.latitudeDelta ?? STREET_DELTA),
        300
      );
    }

    setHeading(0);
    setCameraInfo((prev) => (prev ? { ...prev, heading: 0 } : prev));
  }, [cameraInfo, region.latitude, region.longitude]);

  React.useEffect(() => {
    if (!pin) {
      setSheetState("hidden");
      setPinSaveStatus(null);
      setBulkMovePrompt(null);
      setSocialListOpen(false);
    }
  }, [pin]);

  React.useEffect(() => {
    if (pinSaveStatus === "wishlist") {
      setSocialListOpen(true);
    }
  }, [pinSaveStatus]);

  React.useEffect(() => {
    if (!pin) return;
    if (sheetState === "hidden") return;
    focusOn(pin.lat, pin.lng, { targetSheet: sheetState, animateMs: 250 });
  }, [sheetState, pin, focusOn]);

  // Simple state machine that lets users drag the bottom sheet between predefined positions.
  const sheetPanResponder = React.useMemo(() => {
    const order: SheetState[] = ["hidden", "collapsed", "half", "expanded"];

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 10,
      onPanResponderRelease: (_, gestureState) => {
        const currentIndex = order.indexOf(sheetState);
        if (gestureState.dy < -40) {
          const nextIndex = Math.min(currentIndex + 1, order.length - 1);
          const nextState = order[nextIndex];
          setSheetState(nextState === "hidden" ? "collapsed" : nextState);
        } else if (gestureState.dy > 40) {
          const nextIndex = Math.max(currentIndex - 1, 0);
          setSheetState(order[nextIndex]);
        }
      },
    });
  }, [sheetState]);

  const DOUBLE_TAP_DELAY = 250;
  const lastTapRef = React.useRef<Record<string, number>>({});

  const hasPendingChanges = React.useMemo(
    () =>
      lists.some((list) => (pendingListStates[list.id] ?? "none") !== (initialListStates[list.id] ?? "none")),
    [initialListStates, lists, pendingListStates]
  );

  const handleCancel = React.useCallback(() => {
    setPendingListStates(initialListStates);
    setBulkMovePrompt(null);
    lastTapRef.current = {};
    setListModalVisible(false);
  }, [initialListStates]);

  const openNewListModal = React.useCallback(() => {
    setNewListName("");
    setNewListError(null);
    reopenListModalRef.current = listModalVisible;
    setListModalVisible(false);
    setNewListVisibility("public");
    setNewListModalVisible(true);
  }, [listModalVisible]);

  const closeNewListModal = React.useCallback(
    (options?: { reopenList?: boolean }) => {
      const reopen =
        options?.reopenList !== undefined ? options.reopenList : reopenListModalRef.current;
      setNewListModalVisible(false);
      setNewListError(null);
      setNewListName("");
      setNewListVisibility("public");
      if (reopen && pin) {
        setListModalVisible(true);
      }
      reopenListModalRef.current = false;
    },
    [pin],
  );

  const handleCreateNewList = React.useCallback(() => {
    const trimmed = newListName.trim();
    if (!trimmed) {
      setNewListError("List name is required.");
      return;
    }

    const duplicate = lists.some((list) => list.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      setNewListError("You already have a list with that name.");
      return;
    }

    try {
      const created = addList(trimmed, newListVisibility);
      setInitialListStates((prev) => ({ ...prev, [created.id]: "none" }));
      setPendingListStates((prev) => ({
        ...prev,
        [created.id]: pin ? "wishlist" : "none",
      }));
      setNewListVisibility("public");
      closeNewListModal({ reopenList: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create list.";
      setNewListError(message);
    }
  }, [addList, closeNewListModal, lists, newListName, newListVisibility, pin]);

  const handleDone = React.useCallback(() => {
    if (!pin) {
      setListModalVisible(false);
      return;
    }

    const nextStates: Record<string, ListBucket> = { ...pendingListStates };
    const previousStatus = pinSaveStatus ?? "none";
    const nextStatus = Object.values(nextStates).includes("favourite")
      ? "favourite"
      : Object.values(nextStates).includes("wishlist")
        ? "wishlist"
        : null;
    setPinSaveTransition({ from: previousStatus, to: nextStatus ?? "none" });
    let timestamp = Date.now();
    lists.forEach((list, index) => {
      const initialBucket = initialListStates[list.id] ?? "none";
      const pendingBucket = nextStates[list.id] ?? "none";
      if (initialBucket === pendingBucket) return;

      if (pendingBucket === "none") {
        removeEntry(list.id, pin);
      } else {
        const entry: SavedEntry = {
          listId: list.id,
          listName: list.name,
          bucket: pendingBucket,
          pin,
          savedAt: timestamp + index,
        };
        addEntry(entry);
      }
    });

    setInitialListStates(nextStates);
    setPendingListStates(nextStates);
    setPinSaveStatus(nextStatus);
    setListModalVisible(false);
    setBulkMovePrompt(null);
  }, [addEntry, initialListStates, lists, pendingListStates, pin, pinSaveStatus, removeEntry]);

  const handleSingleTap = React.useCallback((listId: string) => {
    setPendingListStates((prev) => {
      const current = prev[listId] ?? "none";
      const next: ListBucket = current === "wishlist" ? "none" : "wishlist";
      return { ...prev, [listId]: next };
    });
  }, []);

  const maybePromptFavorites = React.useCallback(
    (listId: string, listName: string, states: Record<string, ListBucket>) => {
      const wishlistMatches = lists
        .filter((list) => list.id !== listId && (states[list.id] ?? "none") === "wishlist")
        .map((list) => list.id);
      if (!wishlistMatches.length) return;
      setBulkMovePrompt({
        primaryListId: listId,
        primaryListName: listName,
        wishlistListIds: wishlistMatches,
        locationLabel,
      });
    },
    [lists, locationLabel]
  );

  const handleDoubleTap = React.useCallback(
    (listId: string, listName: string) => {
      const nextStates = { ...pendingListStates, [listId]: "favourite" as ListBucket };
      setPendingListStates(nextStates);
      maybePromptFavorites(listId, listName, nextStates);
    },
    [maybePromptFavorites, pendingListStates]
  );

  const handleHeartPress = React.useCallback(
    (listId: string, listName: string) => {
      const now = Date.now();
      const lastTap = lastTapRef.current[listId] ?? 0;

      if (now - lastTap < DOUBLE_TAP_DELAY) {
        lastTapRef.current[listId] = 0;
        handleDoubleTap(listId, listName);
      } else {
        lastTapRef.current[listId] = now;
        handleSingleTap(listId);
      }
    },
    [handleDoubleTap, handleSingleTap]
  );

  const handleBulkMoveDecision = React.useCallback(
    (applyToAll: boolean) => {
      if (!bulkMovePrompt) {
        setBulkMovePrompt(null);
        return;
      }

      setPendingListStates((prev) => {
        const next = { ...prev, [bulkMovePrompt.primaryListId]: "favourite" as ListBucket };
        if (applyToAll) {
          bulkMovePrompt.wishlistListIds.forEach((id) => {
            next[id] = "favourite";
          });
        }
        return next;
      });

      setBulkMovePrompt(null);
    },
    [bulkMovePrompt]
  );

  React.useEffect(() => {
    if (sheetState === "collapsed" || sheetState === "hidden") {
      if (listModalVisible) {
        handleCancel();
      }
      setBulkMovePrompt(null);
    }
  }, [handleCancel, listModalVisible, sheetState]);

  React.useEffect(() => {
    if (isFocused) {
      return;
    }
    if (listModalVisible) {
      handleCancel();
    }
    if (newListModalVisible) {
      closeNewListModal({ reopenList: false });
    }
    if (bulkMovePrompt) {
      setBulkMovePrompt(null);
    }
  }, [
    bulkMovePrompt,
    closeNewListModal,
    handleCancel,
    isFocused,
    listModalVisible,
    newListModalVisible,
  ]);

  const showSearchBar = sheetState !== "expanded";

  const dismissKeyboard = React.useCallback(() => {
    Keyboard.dismiss();
    searchInputRef.current?.blur();
  }, []);

  const handleCancelSearch = React.useCallback(() => {
    setQuery("");
    setSearchSuggestions([]);
    setSearchFocused(false);
    dismissKeyboard();
  }, [dismissKeyboard]);

  React.useEffect(() => {
    if (!searchFocused) {
      setSearchSuggestions([]);
      setSearchSuggesting(false);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchSuggestions([]);
      setSearchSuggesting(false);
      return;
    }
    const requestId = ++latestSuggestRequestRef.current;
    setSearchSuggesting(true);
    const timer = setTimeout(() => {
      const location = userCoords ? { lat: userCoords.latitude, lng: userCoords.longitude } : undefined;
      searchPlaceAutocomplete({ input: trimmed, location })
        .then((results) => {
          if (latestSuggestRequestRef.current !== requestId) return;
          setSearchSuggestions(results);
        })
        .catch(() => {
          if (latestSuggestRequestRef.current !== requestId) return;
          setSearchSuggestions([]);
        })
        .finally(() => {
          if (latestSuggestRequestRef.current !== requestId) return;
          setSearchSuggesting(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, searchFocused, userCoords]);
  const sheetHeight = SHEET_HEIGHTS[sheetState];
  const isSheetExpanded = sheetState === "expanded";
  const isSheetCollapsed = sheetState === "collapsed";
  const showSuggestions =
    showSearchBar && searchFocused && (searchSuggestions.length > 0 || searchSuggesting);
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={userCoords ? makeRegion(userCoords.latitude, userCoords.longitude) : WORLD}
        region={Platform.OS === "android" ? region : undefined}
        onRegionChangeComplete={async (nextRegion) => {
          setRegion(nextRegion);
          try {
            const camera = await mapRef.current?.getCamera?.();
            if (camera) {
              setCameraInfo(camera);
              if (camera.heading != null) {
                setHeading(camera.heading);
              }
            }
          } catch {
            // ignore inability to fetch camera heading
          }
        }}
        onPress={({ nativeEvent }) => handleMapPress(nativeEvent.coordinate)}
        onLongPress={({ nativeEvent }) => handleMapPress(nativeEvent.coordinate)}
        onPoiClick={handlePoiPress}
        showsScale={false}
        showsCompass={false}
        showsUserLocation={locPerm === "granted"}
        toolbarEnabled={false}
        zoomEnabled
        rotateEnabled
        scrollEnabled
        pitchEnabled
      >
        {pin && <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} />}
      </MapView>

      {showSearchBar && (
        <View style={[styles.searchBarWrapper, { top: insets.top + 16 }]}>
          <View style={styles.searchBarField}>
            <TextInput
              ref={searchInputRef}
              placeholder="Search a place or address"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={({ nativeEvent }) => {
                dismissKeyboard();
                handleSubmit(nativeEvent.text);
              }}
              style={styles.searchInput}
              returnKeyType="search"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              blurOnSubmit
              enablesReturnKeyAutomatically
            />
          </View>
          {(searchFocused || query.length > 0) && (
            <Pressable onPress={handleCancelSearch} style={styles.searchCancelButton}>
              <Text style={styles.searchCancelLabel}>Cancel</Text>
            </Pressable>
          )}
        </View>
      )}
      {showSuggestions && (
        <View style={[styles.searchSuggestions, { top: insets.top + 16 + 52 }]}>
          <FlatList
            data={searchSuggestions}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="always"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setQuery(item.text);
                  dismissKeyboard();
                  setSearchFocused(false);
                  void handleSubmit(item.text);
                }}
                style={styles.searchSuggestionRow}
              >
                <View style={styles.searchSuggestionText}>
                  <Text style={styles.searchSuggestionPrimary} numberOfLines={1}>
                    {item.primaryText}
                  </Text>
                  {item.secondaryText ? (
                    <Text style={styles.searchSuggestionSecondary} numberOfLines={1}>
                      {item.secondaryText}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              searchSuggesting ? (
                <View style={styles.searchSuggestionEmpty}>
                  <Text style={styles.searchSuggestionEmptyText}>Searching...</Text>
                </View>
              ) : null
            }
          />
          <Text style={styles.searchSuggestionFooter}>Powered by Google</Text>
        </View>
      )}

      <View style={styles.recenter}>
        <CompassButton heading={heading} onPress={handleCompassPress} />
        <Pressable onPress={goToMyLocation} style={styles.recenterBtn}>
          <Text style={styles.recenterText}>My Location</Text>
        </Pressable>
      </View>

      {pin && sheetState !== "hidden" && (
        <View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingTop: isSheetCollapsed ? 8 : 12,
              paddingBottom: isSheetCollapsed ? 16 : 24,
            },
          ]}
          {...sheetPanResponder.panHandlers}
        >
          <View style={styles.sheetHandle} />
          <View
            style={[
              styles.sheetHeader,
              isSheetCollapsed && styles.sheetHeaderCollapsed,
            ]}
          >
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {pin.label}
            </Text>
            {isSheetCollapsed ? (
              <Pressable
                onPress={() => {
                  setListModalVisible(true);
                }}
                style={[styles.heartButton, styles.heartButtonSmall]}
                accessibilityRole="button"
                accessibilityLabel="Save to list"
              >
                <View style={[styles.heartIconWrapper, styles.heartIconWrapperSmall]}>
                  <FontAwesome
                    name={pinSaveStatus ? "heart" : "heart-o"}
                    size={16}
                    color={pinSaveStatus ? "#ef4444" : "#0f172a"}
                  />
                  {pinSaveStatus === "favourite" && (
                    <Text style={[styles.heartSparkle, styles.heartSparkleSmall]}>✨</Text>
                  )}
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setSheetState("hidden")}
                style={styles.sheetClose}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            )}
          </View>

          {!isSheetCollapsed && (
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setSocialListOpen(true)}
                style={styles.socialProofBlock}
              >
                <PlaceSocialProof
                  pin={pin}
                  viewerBucket={pinSaveStatus}
                  transition={pinSaveTransition}
                  onTransitionSettled={() => setPinSaveTransition(null)}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  setListModalVisible(true);
                }}
                style={[styles.heartButton, styles.heartButtonCompact]}
                accessibilityRole="button"
                accessibilityLabel="Save to list"
              >
                <View style={[styles.heartIconWrapper, styles.heartIconWrapperCompact]}>
                  <FontAwesome
                    name={pinSaveStatus ? "heart" : "heart-o"}
                    size={18}
                    color={pinSaveStatus ? "#ef4444" : "#0f172a"}
                  />
                  {pinSaveStatus === "favourite" && (
                    <Text style={[styles.heartSparkle, styles.heartSparkleCompact]}>✨</Text>
                  )}
                </View>
              </Pressable>
            </View>
          )}

          {(sheetState === "half" || sheetState === "expanded") && (
            <View style={styles.sheetBody}>
              {socialListOpen ? (
                <View style={styles.socialList}>
                  <Text style={styles.socialListTitle}>Your friends want to go. Visit together!</Text>
                  {socialSavers.length ? (
                    socialSavers.map((profile) => (
                      <View key={profile.id} style={styles.socialRow}>
                        <Pressable
                          style={styles.socialProfile}
                          onPress={() => router.push(`/user/${profile.id}`)}
                        >
                          {profile.photoURL ? (
                            <Image source={{ uri: profile.photoURL }} style={styles.socialAvatar} />
                          ) : (
                            <View style={styles.socialAvatarFallback}>
                              <Text style={styles.socialAvatarText}>
                                {(profile.displayName ?? profile.username ?? "?").charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={styles.socialInfo}>
                            <Text style={styles.socialName} numberOfLines={1}>
                              {profile.displayName ?? "Unknown"}
                            </Text>
                            <Text style={styles.socialUsername} numberOfLines={1}>
                              {profile.username ? `@${profile.username}` : ""}
                            </Text>
                          </View>
                        </Pressable>
                        <Pressable
                          style={styles.socialInvite}
                          accessibilityRole="button"
                          onPress={() => {
                            setInviteTarget(profile);
                            setInviteMessage("");
                            setInviteModalOpen(true);
                          }}
                        >
                          <FontAwesome name="paper-plane" size={16} color="#0f172a" />
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.sheetHint}>No friends have saved this yet.</Text>
                  )}
                </View>
              ) : (
                <Text style={styles.sheetHint}>Future recommendation details will appear here.</Text>
              )}
            </View>
          )}
        </View>
      )}

      <Modal
        transparent
        visible={tenantPickerVisible && !tenantPickerHidden}
        animationType="fade"
        onRequestClose={() => setTenantPickerVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setTenantPickerVisible(false)} />
        <View style={[styles.tenantPickerCard, tenantPickerStyle]}>
          <View style={styles.tenantPickerHeader}>
            <Text style={styles.tenantPickerTitle}>Select a store</Text>
            <Pressable onPress={() => setTenantPickerVisible(false)} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.tenantPickerBody}>
            <View style={styles.tenantFloors}>
              <FlatList
                style={styles.tenantFloorList}
                data={tenantFloors}
                keyExtractor={(item) => item}
                renderItem={({ item }) => {
                  const active = item === tenantFloor;
                  return (
                    <Pressable
                      onPress={() => setTenantFloor(item)}
                      style={[styles.tenantFloorItem, active && styles.tenantFloorItemActive]}
                    >
                      <Text style={[styles.tenantFloorText, active && styles.tenantFloorTextActive]}>
                        {item}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>
            <View style={styles.tenantList}>
              <Text style={styles.tenantFloorHeading}>
                {tenantFloor ?? "All floors"}
              </Text>
              <FlatList
                data={visibleTenants}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable onPress={() => handleTenantSelect(item)} style={styles.tenantItem}>
                    <Text style={styles.tenantItemText} numberOfLines={2}>
                      {item.name}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={listModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <Pressable style={styles.modalBackdrop} onPress={handleCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>
            Save{" "}
            <Text style={styles.modalTitleLocation} numberOfLines={1}>
              {locationLabel}
            </Text>{" "}
            to Your Lists
          </Text>
          <View style={styles.modalListWrapper}>
            <FlatList
              data={lists}
              keyExtractor={(item) => item.id}
              extraData={pendingListStates}
              contentContainerStyle={styles.modalList}
              ListEmptyComponent={() => (
                <View style={styles.modalEmptyState}>
                  <Text style={styles.modalEmptyTitle}>No lists yet</Text>
                  <Text style={styles.modalEmptySubtitle}>
                    Create one to start saving your places.
                  </Text>
                  <Pressable
                    onPress={openNewListModal}
                    style={styles.modalEmptyButton}
                    accessibilityRole="button"
                    accessibilityLabel="Create a new list"
                  >
                    <FontAwesome name="plus" size={16} color="#0f172a" />
                    <Text style={styles.modalEmptyButtonText}>New List</Text>
                  </Pressable>
                </View>
              )}
              renderItem={({ item }) => {
                const currentBucket = pendingListStates[item.id] ?? "none";
                return (
                  <View style={styles.modalListItem}>
                    <Text style={styles.modalListText}>{item.name}</Text>
                    <Pressable
                      style={styles.modalListHeartButton}
                      onPress={() => handleHeartPress(item.id, item.name)}
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle ${item.name}`}
                      hitSlop={12}
                    >
                      <View style={styles.modalListIconWrapper}>
                        {currentBucket === "favourite" ? (
                          <>
                            <FontAwesome name="heart" size={18} color="#ef4444" />
                            <Text style={styles.modalListIconSparkle}>✨</Text>
                          </>
                        ) : currentBucket === "wishlist" ? (
                          <FontAwesome name="heart" size={18} color="#ef4444" />
                        ) : (
                          <FontAwesome name="heart-o" size={18} color="#9ca3af" />
                        )}
                      </View>
                    </Pressable>
                  </View>
                );
              }}
            />
          </View>
          <View style={styles.modalFooter}>
            <View style={styles.modalFooterLeft}>
              <Pressable
                onPress={openNewListModal}
                style={styles.modalNewListButton}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Create a new list"
              >
                <FontAwesome name="plus" size={14} color="#0f172a" />
                <Text style={styles.modalNewListText}>List</Text>
              </Pressable>
              <Pressable onPress={handleCancel} hitSlop={12}>
                <Text style={styles.modalFooterCancel}>Cancel</Text>
              </Pressable>
            </View>
            {hasPendingChanges && (
              <Pressable
                onPress={handleDone}
                style={styles.modalFooterDone}
                accessibilityRole="button"
                accessibilityLabel="Confirm list changes"
                hitSlop={12}
              >
                <Text style={styles.modalFooterDoneText}>Done</Text>
              </Pressable>
            )}
          </View>

        </View>
      </Modal>
      <Modal
        visible={newListModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => closeNewListModal({ reopenList: true })}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => closeNewListModal({ reopenList: true })}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.newListModalWrapper}
        >
          <View style={styles.newListModal}>
            <Text style={styles.newListTitle}>Create a new list</Text>
            <TextInput
              value={newListName}
              onChangeText={(text) => {
                setNewListName(text);
                if (newListError) setNewListError(null);
              }}
              placeholder="Name your list"
              style={styles.newListInput}
              autoFocus
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={handleCreateNewList}
            />
            {newListError && <Text style={styles.newListError}>{newListError}</Text>}
            <View style={styles.modalVisibilitySection}>
              <Text style={styles.modalVisibilityHeading}>Visibility</Text>
              <View style={styles.modalVisibilityOptions}>
                {LIST_VISIBILITY_OPTIONS.map((option) => {
                  const active = newListVisibility === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setNewListVisibility(option.value)}
                      style={[styles.modalVisibilityChip, active && styles.modalVisibilityChipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${option.label} visibility`}
                    >
                      <Text
                        style={[styles.modalVisibilityChipLabel, active && styles.modalVisibilityChipLabelActive]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.modalVisibilityChipHelper}>{option.helper}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.newListActions}>
              <Pressable
                onPress={() => closeNewListModal({ reopenList: true })}
                style={[styles.newListButton, styles.newListButtonSecondary]}
              >
                <Text style={styles.newListButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateNewList}
                style={[styles.newListButton, styles.newListButtonPrimary]}
              >
                <Text style={styles.newListButtonPrimaryText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={!!bulkMovePrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkMovePrompt(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setBulkMovePrompt(null)} />
        {bulkMovePrompt && (
          <View style={styles.bulkModalContent}>
            {bulkMoveListNames.length === 1 ? (
              <>
                <Text style={styles.bulkModalMessage}>
                  <Text style={styles.bulkModalHighlight}>{bulkMovePrompt.locationLabel}</Text>
                  {` is also on the wishlist of `}
                  <Text style={styles.bulkModalListName}>{bulkMoveListNames[0]}</Text>
                  {`.`}
                </Text>
                <Text style={styles.bulkModalMessageSecondary}>
                  Move it to Favorites in that list too?
                </Text>
              </>
            ) : bulkMoveListNames.length > 1 ? (
              <>
                <Text style={styles.bulkModalMessage}>
                  <Text style={styles.bulkModalHighlight}>{bulkMovePrompt.locationLabel}</Text>
                  {` is also on the wishlists of `}
                  {bulkMoveDisplayNames.map((name, index) => (
                    <Text key={`${name}-${index}`} style={styles.bulkModalListName}>
                      {index > 0 ? `, ${name}` : name}
                    </Text>
                  ))}
                  {bulkMoveShowEtc ? ", etc." : ""}
                </Text>
                <Text style={styles.bulkModalMessageSecondary}>
                  Move it to Favorites in all of them?
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.bulkModalMessage}>
                  <Text style={styles.bulkModalHighlight}>{bulkMovePrompt.locationLabel}</Text>
                  {` is also in other wishlists.`}
                </Text>
                <Text style={styles.bulkModalMessageSecondary}>
                  Move it to Favorites in those lists too?
                </Text>
              </>
            )}
            <View style={styles.bulkModalActions}>
              <Pressable
                style={[styles.bulkModalButton, styles.bulkModalButtonPrimary]}
                onPress={() => handleBulkMoveDecision(true)}
              >
                <Text style={[styles.bulkModalButtonText, styles.bulkModalButtonPrimaryText]}>Yes</Text>
              </Pressable>
              <Pressable
                style={[styles.bulkModalButton, styles.bulkModalButtonSecondary]}
                onPress={() => handleBulkMoveDecision(false)}
              >
                <Text style={[styles.bulkModalButtonText, styles.bulkModalButtonSecondaryText]}>No</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>

      <Modal
        visible={inviteModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setInviteModalOpen(false)} />
        <View style={styles.inviteModal}>
          <Text style={styles.inviteTitle}>Invite to visit</Text>
          <TextInput
            value={inviteMessage}
            onChangeText={setInviteMessage}
            placeholder={defaultInviteMessage}
            placeholderTextColor="#94a3b8"
            style={styles.inviteInput}
            multiline
          />
          <View style={styles.inviteActions}>
            <Pressable
              onPress={() => setInviteModalOpen(false)}
              style={[styles.inviteButton, styles.inviteButtonSecondary]}
            >
              <Text style={styles.inviteButtonSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void sendInvite();
              }}
              style={[styles.inviteButton, styles.inviteButtonPrimary]}
            >
              <Text style={styles.inviteButtonPrimaryText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CompassButton({ heading, onPress }: { heading: number; onPress: () => void }) {
  if (Math.abs(heading) < 3) return null;

  return (
    <Pressable
      onPress={onPress}
      style={styles.compassBtn}
      accessibilityRole="button"
      accessibilityLabel="Reset map orientation"
    >
      <Text style={styles.compassText}>N</Text>
      <View
        style={[
          styles.compassNeedleWrapper,
          { transform: [{ rotate: `${-heading}deg` }] },
        ]}
      >
        <FontAwesome name="location-arrow" size={16} color="#fff" style={styles.compassArrow} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  searchBarWrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    zIndex: 10,
  },
  searchBarField: {
    flex: 1,
  },
  searchInput: {
    backgroundColor: "#fff",
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  searchCancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  searchCancelLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  searchSuggestions: {
    position: "absolute",
    left: 16,
    right: 16,
    maxHeight: 260,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 9,
    overflow: "hidden",
  },
  searchSuggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  searchSuggestionText: {
    flex: 1,
  },
  searchSuggestionPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  searchSuggestionSecondary: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  searchSuggestionEmpty: {
    paddingVertical: 16,
    alignItems: "center",
  },
  searchSuggestionEmptyText: {
    fontSize: 12,
    color: "#94a3b8",
  },
  searchSuggestionFooter: {
    fontSize: 10,
    color: "#94a3b8",
    textAlign: "right",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
  },
  recenter: {
    position: "absolute",
    bottom: 24,
    right: 24,
    alignItems: "flex-end",
    gap: 12,
  },
  recenterBtn: {
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  recenterText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  compassBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  compassText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 1,
  },
  compassNeedleWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  compassArrow: {
    marginTop: 2,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
    overflow: "hidden",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 48,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  sheetHeaderCollapsed: {
    marginBottom: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  sheetClose: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.08)",
  },
  sheetCloseText: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 13,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  socialProofBlock: {
    flex: 1,
    paddingRight: 8,
  },
  heartButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  heartButtonSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  heartButtonCompact: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  heartIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  heartIconWrapperSmall: {
    transform: [{ scale: 0.9 }],
  },
  heartIconWrapperCompact: {
    transform: [{ scale: 0.95 }],
  },
  heartSparkle: {
    position: "absolute",
    top: -10,
    right: -8,
    fontSize: 14,
  },
  heartSparkleSmall: {
    top: -8,
    right: -6,
    fontSize: 12,
  },
  heartSparkleCompact: {
    top: -9,
    right: -7,
    fontSize: 13,
  },
  sheetBody: {
    gap: 12,
  },
  sheetMeta: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
  },
  sheetHint: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
  },
  socialList: {
    marginTop: 12,
    gap: 10,
  },
  socialListTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  socialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
  },
  socialAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e2e8f0",
  },
  socialAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  socialAvatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
  socialInfo: {
    flex: 1,
  },
  socialProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  socialName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  socialUsername: {
    fontSize: 12,
    color: "#94a3b8",
  },
  socialInvite: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  inviteModal: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "25%",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 10,
  },
  inviteInput: {
    minHeight: 80,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    textAlignVertical: "top",
  },
  inviteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  inviteButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  inviteButtonPrimary: {
    backgroundColor: "#0f172a",
  },
  inviteButtonSecondary: {
    backgroundColor: "#e2e8f0",
  },
  inviteButtonPrimaryText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  inviteButtonSecondaryText: {
    color: "#0f172a",
    fontWeight: "600",
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
  },
  tenantPickerCard: {
    position: "absolute",
    left: 16,
    right: 16,
    maxHeight: "60%",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  tenantPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  tenantPickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  tenantPickerBody: {
    flexDirection: "row",
    gap: 12,
    maxHeight: "85%",
  },
  tenantFloors: {
    width: 96,
  },
  tenantFloorList: {
    maxHeight: 160,
  },
  tenantFloorItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    marginBottom: 8,
  },
  tenantFloorItemActive: {
    backgroundColor: "#0f172a",
  },
  tenantFloorText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
  },
  tenantFloorTextActive: {
    color: "#ffffff",
  },
  tenantList: {
    flex: 1,
  },
  tenantFloorHeading: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  tenantItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    marginBottom: 8,
  },
  tenantItemText: {
    fontSize: 14,
    color: "#0f172a",
    fontWeight: "600",
  },
  modalContent: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "25%",
    alignSelf: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  modalTitleLocation: {
    color: "#6b7280",
    fontWeight: "600",
  },
  modalList: {
    paddingBottom: 4,
  },
  modalListWrapper: {
    maxHeight: 220,
  },
  modalListItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  modalListText: {
    fontSize: 14,
    color: "#1f2937",
  },
  modalListHeartButton: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  modalListIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 20,
  },
  modalListIconSparkle: {
    position: "absolute",
    top: -10,
    right: -8,
    fontSize: 12,
  },
  modalEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 12,
  },
  modalEmptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  modalEmptySubtitle: {
    fontSize: 13,
    color: "#4b5563",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  modalEmptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5f5",
    backgroundColor: "#f8fafc",
  },
  modalEmptyButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 20,
  },
  modalFooterLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  modalNewListButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5f5",
  },
  modalNewListText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  modalFooterCancel: {
    fontSize: 14,
    color: "#9ca3af",
    fontWeight: "600",
  },
  modalFooterDone: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1d4ed8",
  },
  modalFooterDoneText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  newListModalWrapper: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  newListModal: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 24,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 12,
  },
  newListTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  newListInput: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0f172a",
  },
  newListError: {
    fontSize: 13,
    color: "#ef4444",
  },
  modalVisibilitySection: {
    marginTop: 16,
    gap: 12,
  },
  modalVisibilityHeading: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  modalVisibilityOptions: {
    gap: 10,
    flexDirection: "column",
  },
  modalVisibilityChip: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f8fafc",
    gap: 4,
  },
  modalVisibilityChipActive: {
    borderColor: "#6366f1",
    backgroundColor: "#eef2ff",
  },
  modalVisibilityChipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  modalVisibilityChipLabelActive: {
    color: "#4338ca",
  },
  modalVisibilityChipHelper: {
    fontSize: 12,
    color: "#64748b",
  },
  newListActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 8,
  },
  newListButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  newListButtonSecondary: {
    backgroundColor: "#e2e8f0",
  },
  newListButtonPrimary: {
    backgroundColor: "#6366f1",
  },
  newListButtonSecondaryText: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "600",
  },
  newListButtonPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  bulkModalContent: {
    position: "absolute",
    left: 28,
    right: 28,
    top: "32%",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 22,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 18,
  },
  bulkModalHighlight: {
    fontWeight: "700",
    color: "#0f172a",
  },
  bulkModalMessage: {
    fontSize: 14,
    color: "#4b5563",
    textAlign: "center",
    lineHeight: 20,
  },
  bulkModalListWrapper: {
    marginTop: 10,
    marginBottom: 4,
    gap: 6,
  },
  bulkModalBullet: {
    fontSize: 14,
    color: "#4b5563",
  },
  bulkModalListName: {
    fontStyle: "italic",
    color: "#0f172a",
  },
  bulkModalMessageSecondary: {
    fontSize: 14,
    color: "#0f172a",
    textAlign: "center",
    marginTop: 12,
  },
  bulkModalActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 24,
  },
  bulkModalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  bulkModalButtonPrimary: {
    backgroundColor: "#dcfce7",
  },
  bulkModalButtonPrimaryText: {
    color: "#166534",
  },
  bulkModalButtonSecondary: {
    backgroundColor: "#f1f5f9",
  },
  bulkModalButtonSecondaryText: {
    color: "#0f172a",
  },
  bulkModalButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
