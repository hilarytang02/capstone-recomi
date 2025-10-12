import React from "react";
import { View, StyleSheet, Pressable, Text, Platform, TextInput } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "../../components/MapView";
import * as Location from "expo-location";

const WORLD: Region = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 80,     // big deltas = zoomed out
  longitudeDelta: 180,
};
const STREET_DELTA = 0.0025; // tighter zoom for block-level view
const SHEET_LAT_OFFSET_FACTOR = 0.35; // how far to shift map center when sheet is showing

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

export default function MapScreen() {
  const mapRef = React.useRef<MapView | null>(null);
  const [region, setRegion] = React.useState<Region>(WORLD);
  const [locPerm, setLocPerm] = React.useState<"granted" | "denied" | "undetermined">("undetermined");
  const [query, setQuery] = React.useState("");
  const [pin, setPin] = React.useState<{ lat: number; lng: number } | null>(null);
  const [userCoords, setUserCoords] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  React.useEffect(() => {
    // Prime local state without prompting; fetchUserLocation will handle requests.
    Location.getForegroundPermissionsAsync().then(({ status }) => setLocPerm(status));
  }, []);

  const animateTo = React.useCallback((r: Region, ms = 800) => {
    mapRef.current?.animateToRegion(r, ms);
  }, []);

  const focusOn = React.useCallback(
    (
      latitude: number,
      longitude: number,
      opts?: { delta?: number; sheet?: boolean; animateMs?: number }
    ) => {
      const delta = opts?.delta ?? STREET_DELTA;
      const offsetFactor = opts?.sheet ? SHEET_LAT_OFFSET_FACTOR : 0;
      const nextRegion = makeRegion(latitude, longitude, delta, offsetFactor);
      setRegion(nextRegion);
      animateTo(nextRegion, opts?.animateMs);
      return nextRegion;
    },
    [animateTo]
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
          sheet: sheetOpen,
          animateMs: animate ? 800 : 0,
        });
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
        return nextRegion;
      } catch (err) {
        console.warn("Location lookup failed:", err);
        return null;
      }
    },
    [focusOn, locPerm, sheetOpen]
  );

  const goToMyLocation = React.useCallback(() => {
    void fetchUserLocation(true);
  }, [fetchUserLocation]);

  React.useEffect(() => {
    if (!userCoords) {
      void fetchUserLocation(true);
    }
  }, [fetchUserLocation, userCoords]);
  const handleSubmit = async (raw?: string) => {
    const trimmed = (raw ?? query).trim();
    if (!trimmed) {
      setPin(null);
      setSheetOpen(false);
      return;
    }

    try {
      const results = await Location.geocodeAsync(trimmed);
      const match = results[0];
      if (!match) return;

      const { latitude, longitude } = match;
      setPin({ lat: latitude, lng: longitude });
      setSheetOpen(true);
      focusOn(latitude, longitude, { sheet: true });
    } catch (err) {
      console.warn("Geocoding failed:", err);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={userCoords ? makeRegion(userCoords.latitude, userCoords.longitude) : WORLD}
        region={region}
        onRegionChangeComplete={setRegion}
        onPress={({ nativeEvent }) => {
          const { latitude, longitude } = nativeEvent.coordinate;
          setSheetOpen(true);
          setPin({ lat: latitude, lng: longitude });
          setQuery("");
          focusOn(latitude, longitude, { sheet: true });
        }}
        showsScale
        showsCompass
        showsUserLocation={locPerm === "granted"}
        toolbarEnabled={false}
        zoomEnabled
        rotateEnabled
        scrollEnabled
        pitchEnabled
      >
        {pin && <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} />}
      </MapView>

      <TextInput
        placeholder="Search a place or address"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={({ nativeEvent }) => handleSubmit(nativeEvent.text)}
        style={styles.searchBar}
        blurOnSubmit
        enablesReturnKeyAutomatically
        returnKeyType="search"
      />

      {/* Floating controls */}
      <View style={styles.controls}>
        <FloatingButton
          label="World"
          onPress={() => {
            setPin(null);
            setSheetOpen(false);
            setRegion(WORLD);
            animateTo(WORLD);
          }}
        />
      </View>

      {/* Tiny readout (useful while tuning deltas) */}
      <View style={styles.readout}>
        <Text style={styles.readoutText}>
          {region.latitude.toFixed(3)}, {region.longitude.toFixed(3)} · Δ{region.latitudeDelta.toFixed(2)}/{region.longitudeDelta.toFixed(2)}
        </Text>
      </View>

      <View style={styles.recenter}>
        <Pressable onPress={goToMyLocation} style={styles.recenterBtn}>
          <Text style={styles.recenterText}>My Location</Text>
        </Pressable>
      </View>

      {pin && sheetOpen && (
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Selected Location</Text>
            <Pressable
              onPress={() => {
                setSheetOpen(false);
                if (pin) {
                  focusOn(pin.lat, pin.lng, { sheet: false });
                }
              }}
              style={styles.sheetClose}
            >
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <Text style={styles.sheetMeta}>
              Lat {pin.lat.toFixed(5)} · Lng {pin.lng.toFixed(5)}
            </Text>
            <Text style={styles.sheetHint}>Future recommendation details will appear here.</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function FloatingButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.btn}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  controls: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-start",
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 14,
  },
  btnText: { color: "#fff", fontWeight: "600" },
  readout: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    alignItems: "flex-start",
  },
  readoutText: {
    color: "#fff",
    fontSize: 12,
    opacity: 0.8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 8,
  },
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
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
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
  },
  sheetTitle: {
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
});
