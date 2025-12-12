import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/shared/context/auth";
import { firestore } from "@/shared/firebase/app";
import {
  USERS_COLLECTION,
  isUsernameAvailable,
  updateProfileDetails,
  type UserDocument,
} from "@/shared/api/users";

const BIO_LIMIT = 160;

export default function EditProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [photoURL, setPhotoURL] = React.useState<string | null>(null);

  const [initialUsernameNormalized, setInitialUsernameNormalized] = React.useState<string | null>(null);
  const [usernameError, setUsernameError] = React.useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = React.useState(false);
  const [lastCheckedUsername, setLastCheckedUsername] = React.useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = React.useState(false);

  const normalizedUsername = username.trim().toLowerCase();

  React.useEffect(() => {
    if (!user?.uid) {
      return;
    }
    let active = true;

    const loadProfile = async () => {
      try {
        const snapshot = await getDoc(doc(firestore, USERS_COLLECTION, user.uid));
        if (!active) return;
        const data = snapshot.exists() ? (snapshot.data() as UserDocument) : {};
        const nextDisplay = data.displayName ?? user.displayName ?? "";
        const nextUsername = typeof data.username === "string" ? data.username : "";
        const normalized = nextUsername.trim().toLowerCase();
        setDisplayName(nextDisplay);
        setUsername(nextUsername);
        setInitialUsernameNormalized(normalized || null);
        setLastCheckedUsername(normalized || null);
        setUsernameAvailable(Boolean(normalized));
        const nextBio = typeof data.bio === "string" ? data.bio : "";
        setBio(nextBio);
        const nextPhoto = (data.photoURL ?? user.photoURL) ?? null;
        setPhotoURL(nextPhoto);
      } catch (err) {
        console.error("Failed to load profile", err);
        if (active) {
          Alert.alert("Unable to load profile", "Please try again in a moment.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  const validateUsername = React.useCallback((value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return "Username is required.";
    if (!/^[a-z0-9._]+$/.test(normalized)) return "Only lowercase letters, numbers, . and _ allowed.";
    if (normalized.length < 3) return "Username must be at least 3 characters.";
    if (normalized.length > 24) return "Username is too long.";
    return null;
  }, []);

  const handleUsernameChange = React.useCallback((value: string) => {
    setUsername(value);
    setUsernameError(null);
    setUsernameAvailable(false);
    setLastCheckedUsername(null);
  }, []);

  const handleCheckUsername = React.useCallback(async () => {
    const error = validateUsername(username);
    if (error) {
      setUsernameError(error);
      setUsernameAvailable(false);
      return false;
    }
    const normalized = username.trim().toLowerCase();
    if (normalized && normalized === initialUsernameNormalized) {
      setUsernameError(null);
      setUsernameAvailable(true);
      setLastCheckedUsername(normalized);
      return true;
    }
    if (lastCheckedUsername && normalized === lastCheckedUsername && usernameAvailable && !usernameError) {
      return true;
    }
    setCheckingUsername(true);
    try {
      const available = await isUsernameAvailable(normalized);
      if (!available) {
        setUsernameError("This username is taken. Please choose another.");
        setUsernameAvailable(false);
        return false;
      }
      setUsernameError(null);
      setUsernameAvailable(true);
      setLastCheckedUsername(normalized);
      return true;
    } catch (err) {
      console.error("Username check failed", err);
      setUsernameError("Unable to check availability right now.");
      setUsernameAvailable(false);
      return false;
    } finally {
      setCheckingUsername(false);
    }
  }, [username, validateUsername, initialUsernameNormalized, lastCheckedUsername, usernameAvailable, usernameError]);

  const handlePickImage = React.useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to choose a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length) {
      setPhotoURL(result.assets[0].uri);
    }
  }, []);

  const handleRemovePhoto = React.useCallback(() => {
    setPhotoURL(null);
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!user?.uid) {
      return;
    }
    if (!displayName.trim()) {
      Alert.alert("Name is required", "Please enter your name.");
      return;
    }
    if (!normalizedUsername) {
      setUsernameError("Username is required.");
      return;
    }
    if (!usernameAvailable || lastCheckedUsername !== normalizedUsername) {
      const ok = await handleCheckUsername();
      if (!ok) return;
    }

    setSaving(true);
    try {
      await updateProfileDetails(user.uid, {
        displayName: displayName.trim(),
        username: normalizedUsername,
        bio: bio.trim() ? bio.trim().slice(0, BIO_LIMIT) : null,
        photoURL: photoURL ?? null,
      });
      router.back();
    } catch (err) {
      console.error("Failed to save profile", err);
      Alert.alert("Unable to save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    user?.uid,
    displayName,
    normalizedUsername,
    usernameAvailable,
    lastCheckedUsername,
    handleCheckUsername,
    bio,
    photoURL,
    router,
  ]);

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: Math.max(insets.top, 32) }]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 20,
        gap: 24,
      }}
    >
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <FontAwesome name="chevron-left" size={16} color="#0f172a" />
          <Text style={styles.backLabel}>Profile</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit account</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Profile photo</Text>
        <View style={styles.photoRow}>
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>{displayName.slice(0, 1).toUpperCase() || "?"}</Text>
            </View>
          )}
          <View style={styles.photoActions}>
            <Pressable style={styles.secondaryButton} onPress={handlePickImage}>
              <Text style={styles.secondaryLabel}>Choose photo</Text>
            </Pressable>
            {photoURL ? (
              <Pressable style={styles.linkButton} onPress={handleRemovePhoto}>
                <Text style={styles.linkLabel}>Remove photo</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          style={styles.input}
        />

        <Text style={styles.sectionLabel}>Username</Text>
        <TextInput
          value={username}
          onChangeText={handleUsernameChange}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="lowercase, numbers, . or _"
          style={[styles.input, usernameError ? styles.inputError : null]}
          onBlur={handleCheckUsername}
        />
        {usernameError ? (
          <Text style={styles.errorText}>{usernameError}</Text>
        ) : usernameAvailable && normalizedUsername === lastCheckedUsername ? (
          <Text style={styles.successText}>✓ Username is available</Text>
        ) : null}
        {checkingUsername ? <Text style={styles.helper}>Checking availability…</Text> : null}

        <Text style={styles.sectionLabel}>Bio</Text>
        <TextInput
          value={bio}
          onChangeText={(value) => setBio(value.slice(0, BIO_LIMIT))}
          placeholder="Tell people about yourself"
          multiline
          style={[styles.input, styles.textarea]}
          maxLength={BIO_LIMIT}
        />
        <Text style={styles.helper}>{bio.length}/{BIO_LIMIT} characters</Text>

        <Pressable style={[styles.primaryButton, saving && styles.primaryButtonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Save changes</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backLabel: {
    fontSize: 14,
    color: "#475569",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
  },
  card: {
    borderRadius: 20,
    backgroundColor: "#fff",
    padding: 20,
    gap: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
  photoActions: {
    flex: 1,
    gap: 8,
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#c7d2fe",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#312e81",
  },
  linkButton: {
    paddingVertical: 4,
  },
  linkLabel: {
    fontSize: 13,
    color: "#dc2626",
    textDecorationLine: "underline",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
  },
  inputError: {
    borderColor: "#f87171",
  },
  textarea: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  helper: {
    fontSize: 12,
    color: "#64748b",
  },
  errorText: {
    fontSize: 12,
    color: "#dc2626",
  },
  successText: {
    fontSize: 12,
    color: "#16a34a",
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
