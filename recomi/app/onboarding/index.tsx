import React from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";

import { useAuth } from "@/shared/context/auth";
import { completeOnboarding, isUsernameAvailable } from "@/shared/api/users";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function OnboardingScreen() {
  const { user, setOnboardingComplete } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = React.useState<1 | 2>(1);
  const [displayName, setDisplayName] = React.useState(user?.displayName ?? "");
  const [username, setUsername] = React.useState("" );
  const [bio, setBio] = React.useState("");
  const [usernameError, setUsernameError] = React.useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = React.useState(false);
  const [photoURL, setPhotoURL] = React.useState<string | null>(user?.photoURL ?? null);
  const [saving, setSaving] = React.useState(false);

  const normalizedUsername = username.trim().toLowerCase();

  const validateUsername = React.useCallback((value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return "Username is required.";
    if (!/^[a-z0-9._]+$/.test(normalized)) return "Only lowercase letters, numbers, . and _ allowed.";
    if (normalized.length < 3) return "Username must be at least 3 characters.";
    if (normalized.length > 24) return "Username is too long.";
    return null;
  }, []);

  const handleCheckUsername = React.useCallback(async () => {
    const error = validateUsername(username);
    if (error) {
      setUsernameError(error);
      return false;
    }
    setCheckingUsername(true);
    try {
      const available = await isUsernameAvailable(username);
      if (!available) {
        setUsernameError("This username is taken.");
        return false;
      }
      setUsernameError(null);
      return true;
    } catch (err) {
      console.error("Username check failed", err);
      setUsernameError("Unable to check availability right now.");
      return false;
    } finally {
      setCheckingUsername(false);
    }
  }, [username, validateUsername]);

  const handleNext = async () => {
    const ok = await handleCheckUsername();
    if (!ok) return;
    setStep(2);
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access to set a profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets.length) {
      setPhotoURL(result.assets[0].uri);
    }
  };

  const handleComplete = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      Alert.alert("Name is required", "Please enter your name.");
      return;
    }
    const ok = await handleCheckUsername();
    if (!ok) return;

    setSaving(true);
    try {
      await completeOnboarding(user.uid, {
        displayName: displayName.trim(),
        username: normalizedUsername,
        bio: bio.trim() || null,
        photoURL: photoURL ?? null,
      });
      setOnboardingComplete(true);
      router.replace("/(tabs)/map");
    } catch (err) {
      console.error("Failed to finish onboarding", err);
      Alert.alert("Unable to finish", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: Math.max(insets.top, 16) }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 20, gap: 24 }}
    >
      <View>
        <Text style={styles.stepLabel}>Step {step} of 2</Text>
        <Text style={styles.title}>{step === 1 ? "Set up your profile" : "Add a photo"}</Text>
      </View>

      {step === 1 ? (
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            style={styles.input}
          />

          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="lowercase, numbers, . or _"
            style={[styles.input, usernameError ? styles.inputError : null]}
            onBlur={handleCheckUsername}
          />
          {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
          {checkingUsername ? <Text style={styles.helper}>Checking availability…</Text> : null}

          <Text style={styles.label}>Bio (optional)</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Tell people about yourself"
            multiline
            style={[styles.input, styles.textarea]}
          />

          <Pressable style={styles.primaryButton} onPress={handleNext} disabled={checkingUsername}>
            {checkingUsername ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryLabel}>Next</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Profile picture</Text>
          <View style={styles.avatarRow}>
            {photoURL ? (
              <Image source={{ uri: photoURL }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>{displayName.slice(0, 1).toUpperCase() || "?"}</Text>
              </View>
            )}
            <Pressable style={styles.secondaryButton} onPress={handlePickImage}>
              <Text style={styles.secondaryLabel}>Choose photo</Text>
            </Pressable>
          </View>
          <Text style={styles.helper}>We’ll use your Google photo by default if you skip.</Text>

          <Pressable style={styles.primaryButton} onPress={handleComplete} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Finish</Text>}
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  stepLabel: {
    fontSize: 14,
    color: "#475569",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    marginTop: 4,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  inputError: {
    borderColor: "#ef4444",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
  },
  helper: {
    fontSize: 13,
    color: "#64748b",
  },
  primaryButton: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarPlaceholder: {
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 28,
    fontWeight: "700",
    color: "#475569",
  },
});
