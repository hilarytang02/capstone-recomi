import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";

import { useAuth } from "@/shared/context/auth";

// Basic client-side validation to catch obvious typos before hitting Firebase.
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Presents the email/password signup form and forwards submissions to Firebase Auth.
export default function SignupScreen() {
  const { createAccountWithEmail, signInWithGoogle, isSigningIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Local validation prevents unnecessary network calls and gives better UX.
  const handleCreateAccount = async () => {
    if (submitting) return;

    if (!emailRegex.test(email.trim())) {
      setFormError("Please enter a valid email address.");
      return;
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      await createAccountWithEmail(email.trim(), password);
      router.replace("/onboarding");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to create account.");
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
          placeholder="email"
          placeholderTextColor="#94a3b8"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />

        <View style={styles.inputWrapper}>
          <TextInput
            style={[styles.input, styles.secureInput]}
            placeholder="password"
            placeholderTextColor="#94a3b8"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable style={styles.eyeButton} onPress={() => setShowPassword((prev) => !prev)}>
            <FontAwesome name={showPassword ? "eye-slash" : "eye"} size={18} color="#475569" />
          </Pressable>
        </View>

        <View style={styles.inputWrapper}>
          <TextInput
            style={[styles.input, styles.secureInput]}
            placeholder="confirm password"
            placeholderTextColor="#94a3b8"
            secureTextEntry={!showConfirm}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          <Pressable style={styles.eyeButton} onPress={() => setShowConfirm((prev) => !prev)}>
            <FontAwesome name={showConfirm ? "eye-slash" : "eye"} size={18} color="#475569" />
          </Pressable>
        </View>

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <Pressable
          style={[styles.primaryButton, (submitting || isSigningIn) && styles.disabledButton]}
          onPress={handleCreateAccount}
          disabled={submitting || isSigningIn}
        >
          {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryLabel}>Create an account</Text>}
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

        <Text style={styles.loginPrompt}>
          Already have an account?{" "}
          <Text style={styles.loginLink} onPress={() => router.push("/login")}>
            Log in
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
    alignItems: "center",
    gap: 16,
  },
  brandScript: {
    fontSize: 48,
    color: "#cbd5f5",
    textAlign: "center",
    fontFamily: Platform.select({ ios: "Snell Roundhand", default: "SpaceMono" }),
    fontStyle: Platform.OS === "ios" ? "normal" : "italic",
    marginBottom: 8,
  },
  inputWrapper: {
    width: "100%",
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
  secureInput: {
    paddingRight: 48,
  },
  eyeButton: {
    position: "absolute",
    right: 18,
    top: 16,
  },
  errorText: {
    color: "#f87171",
    textAlign: "center",
    fontSize: 14,
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
    width: "100%",
    marginVertical: 4,
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
  loginPrompt: {
    textAlign: "center",
    color: "#94a3b8",
    marginTop: 6,
  },
  loginLink: {
    color: "#0f172a",
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
});
