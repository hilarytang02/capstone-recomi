import React from "react";
import { StyleSheet, Text, View, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.brandScript}>Recomi</Text>
        <Text style={styles.tagline}>Discover. Save. Share.</Text>

        <Pressable style={styles.primaryButton} onPress={() => router.push("/login")}>
          <FontAwesome name="envelope" size={18} color="#ffffff" />
          <Text style={styles.primaryLabel}>Log in</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/signup")}>
          <FontAwesome name="star" size={16} color="#0f172a" />
          <Text style={styles.secondaryLabel}>Create account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "92%",
    maxWidth: 360,
    alignItems: "center",
    gap: 22,
  },
  brandScript: {
    fontSize: 56,
    color: "#0f172a",
    fontFamily: Platform.select({ ios: "Snell Roundhand", default: "SpaceMono" }),
    fontStyle: Platform.OS === "ios" ? "normal" : "italic",
  },
  tagline: {
    fontSize: 16,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  primaryButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: "#0f172a",
  },
  primaryLabel: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
  secondaryButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#0f172a",
    backgroundColor: "#f1f5f9",
  },
  secondaryLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
});
