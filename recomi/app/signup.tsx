import React from "react";
import { SafeAreaView, StyleSheet, Text } from "react-native";

export default function SignupPlaceholderScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.text}>Sign up screen coming soon.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  text: {
    fontSize: 18,
    color: "#0f172a",
  },
});
