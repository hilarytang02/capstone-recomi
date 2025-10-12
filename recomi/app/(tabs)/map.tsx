import React from "react";
import {
  Dimensions,
  FlatList,
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

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = React.useRef<MapView | null>(null);
  const [region, setRegion] = React.useState<Region>(WORLD);
  const [locPerm, setLocPerm] = React.useState<"granted" | "denied" | "undetermined">("undetermined");
  const [query, setQuery] = React.useState("");
  const [pin, setPin] = React.useState<PinData | null>(null);
  const [userCoords, setUserCoords] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [sheetState, setSheetState] = React.useState<SheetState>("hidden");
  const [listModalVisible, setListModalVisible] = React.useState(false);
  const [heading, setHeading] = React.useState(0);
  const [cameraInfo, setCameraInfo] = React.useState<Camera | null>(null);

  const dummyLists = React.useMemo(
    () => [
      { id: "1", name: "Weekend Brunch Spots" },
      { id: "2", name: "Coffee Crawl" },
      { id: "3", name: "Date Night Ideas" },
      { id: "4", name: "Bucket List Cities" },
      { id: "5", name: "Friend Recs" },
      { id: "6", name: "Hidden Gems" },
    ],
    []
  );

  React.useEffect(() => {
    // Prime local state without prompting; fetchUserLocation will handle requests.
    Location.getForegroundPermissionsAsync().then(({ status }) => setLocPerm(status));
  }, []);

  const animateTo = React.useCallback(
    (r: Region, ms = 800) => mapRef.current?.animateToRegion(r, ms),
    []
  );

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
    setListModalVisible(false);
    void fetchUserLocation(true);
  }, [fetchUserLocation]);

  React.useEffect(() => {
    void fetchUserLocation(true);
    // We intentionally ignore dependency warnings so closing the sheet does not re-trigger centering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (raw?: string) => {
    const trimmed = (raw ?? query).trim();
    if (!trimmed) {
      setPin(null);
      setSheetState("hidden");
      setListModalVisible(false);
      return;
    }

    try {
      const results = await Location.geocodeAsync(trimmed);
      const match = results[0];
      if (!match) return;

      const { latitude, longitude } = match;
      const label = buildLabel(match, trimmed);
      setPin({ lat: latitude, lng: longitude, label });
      setSheetState("half");
      focusOn(latitude, longitude, { targetSheet: "half" });
    } catch (err) {
      console.warn("Geocoding failed:", err);
    }
  };

  const handleMapPress = ({ latitude, longitude }: { latitude: number; longitude: number }) => {
    const basePin: PinData = { lat: latitude, lng: longitude, label: "Dropped pin" };
    setPin(basePin);
    setQuery("");
    setSheetState("half");
    focusOn(latitude, longitude, { targetSheet: "half" });

    void Location.reverseGeocodeAsync({ latitude, longitude })
      .then((results) => {
        const name = buildLabel(results?.[0], basePin.label);
        setPin((current) => {
          if (!current) return current;
          return coordsMatch(current, basePin) ? { ...current, label: name } : current;
        });
      })
      .catch((err) => {
        console.warn("Reverse geocode failed:", err);
      });
  };

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
    }
  }, [pin]);

  React.useEffect(() => {
    if (sheetState === "collapsed" || sheetState === "hidden") {
      setListModalVisible(false);
    }
  }, [sheetState]);

  React.useEffect(() => {
    if (!pin) return;
    if (sheetState === "hidden") return;
    focusOn(pin.lat, pin.lng, { targetSheet: sheetState, animateMs: 250 });
  }, [sheetState, pin, focusOn]);

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

  const showSearchBar = sheetState !== "expanded";
  const sheetHeight = SHEET_HEIGHTS[sheetState];
  const isSheetExpanded = sheetState === "expanded";
  const isSheetCollapsed = sheetState === "collapsed";

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={userCoords ? makeRegion(userCoords.latitude, userCoords.longitude) : WORLD}
        region={region}
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
        <TextInput
          placeholder="Search a place or address"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={({ nativeEvent }) => handleSubmit(nativeEvent.text)}
          style={[styles.searchBar, { top: insets.top + 16 }]}
          blurOnSubmit
          enablesReturnKeyAutomatically
          returnKeyType="search"
        />
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
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {pin.label}
            </Text>
            {isSheetCollapsed ? (
              <Pressable
                onPress={() => setListModalVisible(true)}
                style={[styles.heartButton, styles.heartButtonSmall]}
                accessibilityRole="button"
                accessibilityLabel="Save to list"
              >
                <Text style={styles.heartIcon}>♡</Text>
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
                onPress={() => setListModalVisible(true)}
                style={styles.heartButton}
                accessibilityRole="button"
                accessibilityLabel="Save to list"
              >
                <Text style={styles.heartIcon}>♡</Text>
              </Pressable>
            </View>
          )}

          {(sheetState === "half" || sheetState === "expanded") && (
            <View style={styles.sheetBody}>
              <Text style={styles.sheetMeta}>
                Lat {pin.lat.toFixed(5)} · Lng {pin.lng.toFixed(5)}
              </Text>
              <Text style={styles.sheetHint}>Future recommendation details will appear here.</Text>
            </View>
          )}
        </View>
      )}

      <Modal
        visible={listModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setListModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setListModalVisible(false)} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Save to a list</Text>
          <FlatList
            data={dummyLists}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.modalList}
            renderItem={({ item }) => (
              <Pressable
                style={styles.modalListItem}
                onPress={() => setListModalVisible(false)}
              >
                <Text style={styles.modalListText}>{item.name}</Text>
              </Pressable>
            )}
          />
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
  searchBar: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: "white",
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 10,
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
    alignItems: "center",
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
    justifyContent: "flex-start",
    marginBottom: 20,
    gap: 12,
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
  heartIcon: {
    fontSize: 22,
    color: "#0f172a",
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
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
  },
  modalContent: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 40,
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
  modalList: {
    paddingBottom: 4,
  },
  modalListItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  modalListText: {
    fontSize: 14,
    color: "#1f2937",
  },
});
