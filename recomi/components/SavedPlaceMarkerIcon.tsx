import React from "react";
import { StyleSheet, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

export type SavedPlaceMarkerSource = "self" | "friend" | "liked";
export type SavedPlaceMarkerBucket = "wishlist" | "favourite";

export function SavedPlaceMarkerIcon({
  bucket,
  source,
}: {
  bucket: SavedPlaceMarkerBucket;
  source: SavedPlaceMarkerSource;
}) {
  const filledBackground = source === "friend" || source === "liked";
  const outerStyles = [
    styles.outer,
    filledBackground ? styles.outerFilled : styles.outerPlain,
  ];
  const heartColor = filledBackground ? "#ffffff" : "#dc2626";
  const sparkleColor = filledBackground ? "#fde68a" : "#f59e0b";

  return (
    <View style={outerStyles}>
      <FontAwesome name="heart" size={10} color={heartColor} />
      {bucket === "favourite" ? (
        <Text style={[styles.sparkle, { color: sparkleColor }]}>✦</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  outerPlain: {
    backgroundColor: "#ffffff",
    borderColor: "rgba(220,38,38,0.28)",
  },
  outerFilled: {
    backgroundColor: "#dc2626",
    borderColor: "#ffffff",
  },
  sparkle: {
    position: "absolute",
    top: -3,
    right: -2,
    fontSize: 9,
    fontWeight: "700",
  },
});
