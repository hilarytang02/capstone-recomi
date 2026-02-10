import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import type { User } from "@firebase/auth-types";
import type { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { useRouter, usePathname, useRootNavigationState } from "expo-router";

import { auth } from "../firebase/app";
import { findUserByUsername, upsertUserProfileFromAuth } from "../api/users";
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
  signInWithUsername: (username: string, password: string) => Promise<void>;
  createAccountWithEmail: (email: string, password: string, username?: string) => Promise<void>;
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
    // Keep Auth state, profile doc, and onboarding flag in sync with Firebase.
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

  // Support both username+password and email+password sign-ins by resolving usernames to emails.
  const signInWithUsername = React.useCallback(async (identifier: string, password: string) => {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      throw new Error("Username or email is required.");
    }
    if (!password.trim()) {
      throw new Error("Password is required.");
    }

    try {
      let emailToUse: string | null = null;
      if (trimmedIdentifier.includes("@")) {
        emailToUse = trimmedIdentifier.toLowerCase();
      } else {
        const record = await findUserByUsername(trimmedIdentifier);
        if (!record || !record.data.email) {
          throw new Error("No account found for that username.");
        }
        emailToUse = record.data.email;
      }
      await signInWithEmailAndPassword(auth, emailToUse, password);
      if (!auth.currentUser) {
        throw new Error("Sign-in did not complete. Please try again.");
      }
    } catch (err) {
      console.error("Username sign-in failed", err);
      const errCode = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : null;
      if (errCode === "auth/invalid-credential" || errCode === "auth/wrong-password") {
        throw new Error("Incorrect username/email or password. If you signed up with Google, use Google sign-in.");
      }
      if (errCode === "auth/user-not-found") {
        throw new Error("No account found for that email.");
      }
      if (err instanceof FirebaseError) {
        if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
          throw new Error("Incorrect username/email or password. If you signed up with Google, use Google sign-in.");
        }
        throw new Error(err.message);
      }
      if (err instanceof Error) {
        throw err;
      }
      throw new Error("Unable to sign in. Please try again.");
    }
  }, []);

  // Exposed so the signup screen can provision new email/password accounts.
  const createAccountWithEmail = React.useCallback(async (email: string, password: string, username?: string) => {
    const normalizedUsername = username ? username.trim().toLowerCase() : null;
    const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (result.user && normalizedUsername) {
      await upsertUserProfileFromAuth(result.user, { username: normalizedUsername });
    }
  }, []);

  const value = React.useMemo(
    () => ({
      user,
      initializing,
      isSigningIn,
      error,
      signInWithGoogle,
      signInWithUsername,
      createAccountWithEmail,
      signOut,
      onboardingComplete,
      onboardingLoading,
      setOnboardingComplete,
    }),
    [user, initializing, isSigningIn, error, signInWithGoogle, signInWithUsername, createAccountWithEmail, signOut, onboardingComplete, onboardingLoading]
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
  const { user, initializing, onboardingComplete, onboardingLoading } = useAuth();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const router = useRouter();
  const isOnboardingRoute = pathname?.startsWith("/onboarding");
  const publicRoutes = ["/welcome", "/login", "/signup"];
  const isPublicRoute = pathname ? publicRoutes.some((route) => pathname === route || pathname.startsWith(route)) : false;

  // Centralized routing decisions so we never render a screen outside the expected flow.
  const redirectHref = React.useMemo(() => {
    if (initializing || onboardingLoading) {
      return null;
    }
    if (!user && !isPublicRoute) {
      return "/welcome";
    }
    if (user && !onboardingLoading && !onboardingComplete && !isOnboardingRoute) {
      return "/onboarding";
    }
    if (user && onboardingComplete && (isOnboardingRoute || isPublicRoute)) {
      return "/(tabs)/map";
    }
    return null;
  }, [user, isPublicRoute, onboardingComplete, onboardingLoading, isOnboardingRoute, initializing, pathname]);

  const canNavigateToRedirect = React.useMemo(() => {
    if (!redirectHref || redirectHref === pathname) {
      return false;
    }
    return true;
  }, [redirectHref, pathname]);

  React.useEffect(() => {
    // Router redirects must happen imperatively; defer until values settle.
    if (!rootNavigationState?.key) {
      return;
    }
    if (canNavigateToRedirect) {
      router.replace(redirectHref as string);
    }
  }, [canNavigateToRedirect, redirectHref, router, rootNavigationState]);

  const isNavigating = canNavigateToRedirect;

  const shouldBlock = initializing || onboardingLoading || !rootNavigationState?.key;

  return (
    <>
      {children}
      {shouldBlock || isNavigating ? (
        <View style={[styles.overlay, shouldBlock ? styles.overlaySolid : null]}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#f8fafcAA",
    alignItems: "center",
    justifyContent: "center",
  },
  overlaySolid: {
    backgroundColor: "#f8fafc",
  },
});

export { AuthProvider, useAuth, AuthGate };
