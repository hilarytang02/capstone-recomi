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

export default function MapScreen() {
  const mapRef = React.useRef<MapView | null>(null);
  const [region, setRegion] = React.useState<Region>(WORLD);
  const [locPerm, setLocPerm] = React.useState<"granted" | "denied" | "undetermined">("undetermined");
  const [query, setQuery] = React.useState("");
  const [pin, setPin] = React.useState<{ lat: number; lng: number } | null>(null);

  React.useEffect(() => {
    // ask once (you can move this behind a button if you prefer)
    Location.requestForegroundPermissionsAsync().then(({ status }) => setLocPerm(status));
  }, []);

  const animateTo = (r: Region, ms = 800) => mapRef.current?.animateToRegion(r, ms);

  const goToMyLocation = async () => {
    try {
      if (locPerm !== "granted") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setLocPerm(status);
        if (status !== "granted") return;
      }
      const { coords } = await Location.getCurrentPositionAsync({});
      animateTo({
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    } catch {
      // ignore for now; you can toast an error message later
    }
  };
  const handleSearch = async (text: string) => {
    setQuery(text);
    const trimmed = text.trim();
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
      animateTo({
        latitude,
        longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
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
        initialRegion={WORLD}
        onRegionChangeComplete={setRegion}
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
        onChangeText={handleSearch}
        style={styles.searchBar}
        returnKeyType="search"
      />

      {/* Floating controls */}
      <View style={styles.controls}>
        <FloatingButton label="World" onPress={() => animateTo(WORLD)} />
        <FloatingButton label="My Loc" onPress={goToMyLocation} />
      </View>

      {/* Tiny readout (useful while tuning deltas) */}
      <View style={styles.readout}>
        <Text style={styles.readoutText}>
          {region.latitude.toFixed(3)}, {region.longitude.toFixed(3)} · Δ{region.latitudeDelta.toFixed(2)}/{region.longitudeDelta.toFixed(2)}
        </Text>
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
});
