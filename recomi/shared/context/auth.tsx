import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { GoogleAuthProvider, User, onAuthStateChanged, signInWithCredential, signOut as firebaseSignOut } from "firebase/auth";

import { auth } from "../firebase/app";

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  isSigningIn: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

const googleClientConfig = {
  expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [initializing, setInitializing] = React.useState(true);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    expoClientId: googleClientConfig.expoClientId,
    iosClientId: googleClientConfig.iosClientId,
    androidClientId: googleClientConfig.androidClientId,
    webClientId: googleClientConfig.webClientId,
    scopes: ["profile", "email"],
    prompt: "select_account",
  });

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setInitializing(false);
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
          await signInWithCredential(auth, credential);
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
        useProxy: true,
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
    () => ({ user, initializing, isSigningIn, error, signInWithGoogle, signOut }),
    [user, initializing, isSigningIn, error, signInWithGoogle, signOut]
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
  const { user, initializing, isSigningIn, signInWithGoogle, error } = useAuth();

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
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to Recomi</Text>
        <Text style={styles.subtitle}>
          Sign in with Google to access your saved places across devices.
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          onPress={onSignIn}
          style={styles.signInButton}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <>
              <View style={styles.googleChip}>
                <Text style={styles.googleLetter}>G</Text>
              </View>
              <Text style={styles.signInLabel}>Sign in with Google</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  content: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 20,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#475569",
    textAlign: "center",
  },
  errorText: {
    fontSize: 13,
    color: "#ef4444",
    textAlign: "center",
  },
  signInButton: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#e2e8f0",
    width: "100%",
  },
  signInLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  googleChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  googleLetter: {
    fontWeight: "700",
    color: "#ea4335",
  },
});

export { AuthProvider, useAuth, AuthGate };
