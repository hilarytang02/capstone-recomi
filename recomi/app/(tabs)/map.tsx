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

const makeRegion = (latitude: number, longitude: number, delta = STREET_DELTA): Region => ({
  latitude,
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

  React.useEffect(() => {
    // Prime local state without prompting; fetchUserLocation will handle requests.
    Location.getForegroundPermissionsAsync().then(({ status }) => setLocPerm(status));
  }, []);

  const animateTo = React.useCallback(
    (r: Region, ms = 800) => mapRef.current?.animateToRegion(r, ms),
    []
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
        const nextRegion = makeRegion(coords.latitude, coords.longitude);
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
        setRegion(nextRegion);
        if (animate) {
          animateTo(nextRegion);
        }
        return nextRegion;
      } catch (err) {
        console.warn("Location lookup failed:", err);
        return null;
      }
    },
    [animateTo, locPerm]
  );

  const goToMyLocation = React.useCallback(() => {
    void fetchUserLocation(true);
  }, [fetchUserLocation]);

  React.useEffect(() => {
    void fetchUserLocation(true);
  }, [fetchUserLocation]);
  const handleSubmit = async (raw?: string) => {
    const trimmed = (raw ?? query).trim();
    if (!trimmed) {
      setPin(null);
      return;
    }

    try {
      const results = await Location.geocodeAsync(trimmed);
      const match = results[0];
      if (!match) return;

      const { latitude, longitude } = match;
      setPin({ lat: latitude, lng: longitude });
      const nextRegion = makeRegion(latitude, longitude);
      setRegion(nextRegion);
      animateTo(nextRegion);
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
          const nextRegion = makeRegion(latitude, longitude);
          setPin({ lat: latitude, lng: longitude });
          setQuery("");
          setRegion(nextRegion);
          animateTo(nextRegion);
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
});
