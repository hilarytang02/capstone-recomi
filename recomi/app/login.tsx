import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/shared/context/auth";

export default function LoginScreen() {
  const { signInWithUsername, signInWithGoogle, isSigningIn, error } = useAuth();
  const router = useRouter();

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await signInWithUsername(username, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.brandScript}>Recomi</Text>

        <TextInput
          style={styles.input}
          placeholder="username or email"
          placeholderTextColor="#94a3b8"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor="#94a3b8"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <Pressable style={[styles.primaryButton, submitting && styles.disabledButton]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryLabel}>Log in</Text>}
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerLabel}>OR</Text>
          <View style={styles.line} />
        </View>

        <Pressable
          style={[styles.googleButton, (isSigningIn || submitting) && styles.disabledButton]}
          onPress={signInWithGoogle}
          disabled={isSigningIn || submitting}
        >
          {isSigningIn ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <>
              <View style={styles.googleIcon}>
                <Text style={styles.googleGlyph}>G</Text>
              </View>
              <Text style={styles.googleLabel}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={styles.signupPrompt}>
          Didn't have an account?{" "}
          <Text style={styles.signupLink} onPress={() => router.push("/signup")}>
            Sign up
          </Text>
        </Text>
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
    alignSelf: "center",
    gap: 16,
    alignItems: "center",
  },
  brandScript: {
    fontSize: 52,
    color: "#94a3b8",
    textAlign: "center",
    fontFamily: Platform.select({ ios: "Snell Roundhand", default: "SpaceMono" }),
    fontStyle: Platform.OS === "ios" ? "normal" : "italic",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontSize: 16,
    color: "#0f172a",
    backgroundColor: "transparent",
    width: "100%",
  },
  errorText: {
    color: "#f87171",
    fontSize: 14,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#0f172a",
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
  },
  primaryLabel: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 8,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#cbd5f5",
  },
  dividerLabel: {
    color: "#94a3b8",
    fontSize: 12,
    letterSpacing: 2,
  },
  googleButton: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#0f172a",
    paddingVertical: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    width: "100%",
  },
  googleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  googleGlyph: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 18,
  },
  googleLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  signupPrompt: {
    textAlign: "center",
    color: "#94a3b8",
    marginTop: 8,
  },
  signupLink: {
    color: "#0f172a",
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
});
