import React from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View, Platform } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import type { User } from "@firebase/auth-types";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";
import { Redirect, usePathname } from "expo-router";

import { auth } from "../firebase/app";
import { upsertUserProfileFromAuth } from "../api/users";
import { doc, getDoc } from "firebase/firestore";
import { firestore } from "../firebase/app";
import { USERS_COLLECTION } from "../api/users";

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  isSigningIn: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  onboardingComplete: boolean;
  onboardingLoading: boolean;
  setOnboardingComplete: (value: boolean) => void;
};

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

const googleClientConfig = {
  expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME,
};

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [initializing, setInitializing] = React.useState(true);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = React.useState(false);
  const [onboardingLoading, setOnboardingLoading] = React.useState(true);

  const useProxy = Constants.appOwnership === "expo";
  const redirectUri = makeRedirectUri({
    useProxy,
    native: googleClientConfig.iosUrlScheme
      ? `${googleClientConfig.iosUrlScheme}:/oauthredirect`
      : undefined,
  });

  const [request, response, promptAsync] = Google.useAuthRequest(
    {
      expoClientId: googleClientConfig.expoClientId,
      iosClientId: googleClientConfig.iosClientId,
      androidClientId: googleClientConfig.androidClientId,
      webClientId: googleClientConfig.webClientId,
      scopes: ["profile", "email"],
      prompt: "select_account",
      redirectUri,
    },
    { useProxy }
  );

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setInitializing(false);
      if (firebaseUser) {
        setOnboardingLoading(true);
        void upsertUserProfileFromAuth(firebaseUser).catch((err) => {
          console.error("Failed to ensure user profile", err);
        });
        void (async () => {
          try {
            const snap = await getDoc(doc(firestore, USERS_COLLECTION, firebaseUser.uid));
            if (!snap.exists()) {
              setOnboardingComplete(false);
            } else {
              const data = snap.data();
              const flag = typeof data.hasCompletedOnboarding === "boolean" ? data.hasCompletedOnboarding : false;
              setOnboardingComplete(flag);
            }
          } catch (err) {
            console.error("Failed to check onboarding flag", err);
            setOnboardingComplete(false);
          } finally {
            setOnboardingLoading(false);
          }
        })();
      } else {
        setOnboardingComplete(false);
        setOnboardingLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    const handleResponse = async () => {
      if (response?.type === "success") {
        try {
          const idToken = response.authentication?.idToken;
          if (!idToken) {
            throw new Error("Google authentication did not return an ID token.");
          }
          const credential = GoogleAuthProvider.credential(idToken);
          const result = await signInWithCredential(auth, credential);
          if (result.user) {
            await upsertUserProfileFromAuth(result.user);
          }
          setError(null);
        } catch (err) {
          console.error("Google sign-in failed", err);
          setError(err instanceof Error ? err.message : "Google sign-in failed");
        } finally {
          setIsSigningIn(false);
        }
      } else if (response?.type === "error") {
        setError(response.error?.message ?? "Google sign-in failed");
        setIsSigningIn(false);
      } else if (response?.type && response.type !== "success") {
        setIsSigningIn(false);
      }
    };

    void handleResponse();
  }, [response]);

  const signInWithGoogle = React.useCallback(async () => {
    if (!request) {
      setError("Google sign-in is not available yet. Please try again in a moment.");
      return;
    }

    setError(null);
    setIsSigningIn(true);
    try {
      await promptAsync({
        useProxy,
        showInRecents: true,
      });
    } catch (err) {
      console.error("Google prompt failed", err);
      setError(err instanceof Error ? err.message : "Unable to start Google sign-in");
      setIsSigningIn(false);
    }
  }, [promptAsync, request]);

  const signOut = React.useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const value = React.useMemo(
    () => ({
      user,
      initializing,
      isSigningIn,
      error,
      signInWithGoogle,
      signOut,
      onboardingComplete,
      onboardingLoading,
      setOnboardingComplete,
    }),
    [user, initializing, isSigningIn, error, signInWithGoogle, signOut, onboardingComplete, onboardingLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, initializing, isSigningIn, signInWithGoogle, error, onboardingComplete, onboardingLoading } = useAuth();
  const pathname = usePathname();
  const isOnboardingRoute = pathname?.startsWith("/onboarding");

  if (initializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  if (!user) {
    return (
      <AuthLanding
        loading={isSigningIn}
        onSignIn={signInWithGoogle}
        error={error}
      />
    );
  }

  if (onboardingLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  if (!onboardingComplete && !isOnboardingRoute) {
    return <Redirect href="/onboarding" />;
  }

  if (onboardingComplete && isOnboardingRoute) {
    return <Redirect href="/(tabs)/map" />;
  }

  return <>{children}</>;
}

function AuthLanding({
  loading,
  onSignIn,
  error,
}: {
  loading: boolean;
  onSignIn: () => void | Promise<void>;
  error: string | null;
}) {
  const handleCreateAccount = React.useCallback(() => {
    onSignIn();
  }, [onSignIn]);

  return (
    <SafeAreaView style={styles.authRoot}>
      <View style={styles.authCard}>
        <Text style={styles.brandScript}>Recomi</Text>
        <Text style={styles.brandTagline}>Discover. Save. Share.</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          onPress={onSignIn}
          style={styles.primaryButton}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <FontAwesome name="envelope" size={18} color="#ffffff" />
              <Text style={styles.primaryLabel}>Log in</Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={handleCreateAccount}
          style={styles.secondaryButton}
          disabled={loading}
        >
          <FontAwesome name="star" size={16} color="#0f172a" />
          <Text style={styles.secondaryLabel}>Create account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authRoot: {
    flex: 1,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  authCard: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: 18,
  },
  brandScript: {
    fontSize: 48,
    color: "#0f172a",
    fontFamily: Platform.select({ ios: "Snell Roundhand", default: "SpaceMono" }),
    fontStyle: Platform.OS === "ios" ? "normal" : "italic",
  },
  brandTagline: {
    fontSize: 16,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  errorText: {
    fontSize: 14,
    color: "#fca5a5",
    textAlign: "center",
    marginBottom: 12,
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

export { AuthProvider, useAuth, AuthGate };
