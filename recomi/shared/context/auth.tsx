import React from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  OAuthProvider,
  type User,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { useRouter, usePathname, useRootNavigationState } from "expo-router";

import { auth } from "../firebase/app";
import { findUserByUsername, resolveUsernameEmail, upsertUserProfileFromAuth } from "../api/users";
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
  signInWithApple: () => Promise<void>;
  canSignInWithApple: boolean;
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
  const [canSignInWithApple, setCanSignInWithApple] = React.useState(false);
  const [onboardingComplete, setOnboardingComplete] = React.useState(false);
  const [onboardingLoading, setOnboardingLoading] = React.useState(true);

  const useProxy = Constants.appOwnership === "expo";
  const redirectUri = makeRedirectUri(
    {
      native: googleClientConfig.iosUrlScheme
        ? `${googleClientConfig.iosUrlScheme}:/oauthredirect`
        : undefined,
      ...(useProxy ? ({ useProxy: true } as object) : {}),
    } as Parameters<typeof makeRedirectUri>[0]
  );

  const [request, response, promptAsync] = Google.useAuthRequest(
    {
      clientId: googleClientConfig.expoClientId ?? googleClientConfig.webClientId,
      iosClientId: googleClientConfig.iosClientId,
      androidClientId: googleClientConfig.androidClientId,
      webClientId: googleClientConfig.webClientId,
      scopes: ["profile", "email"],
      extraParams: { prompt: "select_account" },
      redirectUri,
    },
    ({ ...(useProxy ? { useProxy: true } : {}) } as unknown) as Parameters<typeof Google.useAuthRequest>[1]
  );

  React.useEffect(() => {
    if (Platform.OS !== "ios") {
      setCanSignInWithApple(false);
      return;
    }

    let cancelled = false;
    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        console.log("[auth] Apple sign-in available:", available);
        if (!cancelled) {
          setCanSignInWithApple(available);
        }
      })
      .catch((err) => {
        console.warn("[auth] Apple sign-in availability check failed:", err);
        if (!cancelled) {
          setCanSignInWithApple(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        // Push notifications disabled for now (no APNs). In-app invites still work.
      } else {
        setOnboardingComplete(false);
        setOnboardingLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    const handleResponse = async () => {
      const responseType = response?.type as string | undefined;
      if (responseType === "success") {
        try {
          const successResponse = response as { authentication?: { idToken?: string | null } } | null;
          const idToken = successResponse?.authentication?.idToken;
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
      } else if (responseType === "error") {
        const errorResponse = response as { error?: { message?: string | null } } | null;
        setError(errorResponse?.error?.message ?? "Google sign-in failed");
        setIsSigningIn(false);
      } else if (responseType) {
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
      await promptAsync(({ ...(useProxy ? { useProxy: true } : {}), showInRecents: true } as unknown) as Parameters<
        typeof promptAsync
      >[0]);
    } catch (err) {
      console.error("Google prompt failed", err);
      setError(err instanceof Error ? err.message : "Unable to start Google sign-in");
      setIsSigningIn(false);
    }
  }, [promptAsync, request]);

  const signInWithApple = React.useCallback(async () => {
    if (Platform.OS !== "ios" || !canSignInWithApple) {
      setError("Apple sign-in is only available on supported iOS devices.");
      return;
    }

    setError(null);
    setIsSigningIn(true);
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      console.log("[auth] Apple credential received:", {
        user: credential.user ?? null,
        email: credential.email ?? null,
        fullName: credential.fullName ?? null,
        hasIdentityToken: Boolean(credential.identityToken),
      });

      if (!credential.identityToken) {
        throw new Error("Apple authentication did not return an identity token.");
      }

      const provider = new OAuthProvider("apple.com");
      const firebaseCredential = provider.credential({
        idToken: credential.identityToken,
        rawNonce,
      });
      const result = await signInWithCredential(auth, firebaseCredential);
      if (result.user) {
        const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter(Boolean)
          .join(" ")
          .trim();
        await upsertUserProfileFromAuth(result.user, {
          ...(fullName ? { displayName: fullName } : {}),
          ...(credential.email ? { email: credential.email } : {}),
        });
      }
    } catch (err) {
      const errCode =
        typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : null;
      console.warn("[auth] Apple sign-in native error code:", errCode, err);
      if (
        errCode === "ERR_REQUEST_CANCELED"
      ) {
        setError(null);
      } else {
        console.error("Apple sign-in failed", err);
        // Surface a clearer message in the UI for debugging: include native error code and message
        const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
        const displayMessage = errCode ? `${errCode}: ${errorMessage}` : errorMessage || "Apple sign-in failed";
        setError(displayMessage);
      }
    } finally {
      setIsSigningIn(false);
    }
  }, [canSignInWithApple]);

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
        try {
          const record = await findUserByUsername(trimmedIdentifier);
          if (record?.data.email) {
            emailToUse = record.data.email;
          }
        } catch (err) {
          const errCode =
            typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : null;
          if (errCode !== "permission-denied") {
            throw err;
          }
        }
        if (!emailToUse) {
          emailToUse = await resolveUsernameEmail(trimmedIdentifier);
        }
        if (!emailToUse) {
          throw new Error("No account found for that username.");
        }
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
    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (result.user && normalizedUsername) {
        await upsertUserProfileFromAuth(result.user, { username: normalizedUsername });
      }
    } catch (err) {
      if (err instanceof FirebaseError) {
        if (err.code === "auth/email-already-in-use") {
          throw new Error("This email is already tied to an existing account.");
        }
        if (err.code === "auth/invalid-email") {
          throw new Error("Please enter a valid email address.");
        }
        if (err.code === "auth/weak-password") {
          throw new Error("Your password is too weak. Please choose a stronger password.");
        }
        throw new Error(err.message);
      }
      if (err instanceof Error) {
        throw err;
      }
      throw new Error("Unable to create account. Please try again.");
    }
  }, []);

  const value = React.useMemo(
    () => ({
      user,
      initializing,
      isSigningIn,
      error,
      signInWithGoogle,
      signInWithApple,
      canSignInWithApple,
      signInWithUsername,
      createAccountWithEmail,
      signOut,
      onboardingComplete,
      onboardingLoading,
      setOnboardingComplete,
    }),
    [
      user,
      initializing,
      isSigningIn,
      error,
      signInWithGoogle,
      signInWithApple,
      canSignInWithApple,
      signInWithUsername,
      createAccountWithEmail,
      signOut,
      onboardingComplete,
      onboardingLoading,
    ]
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
      if (pathname?.startsWith("/signup")) {
        return null;
      }
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
      router.replace(redirectHref as Parameters<typeof router.replace>[0]);
    }
  }, [canNavigateToRedirect, redirectHref, router, rootNavigationState]);

  const isNavigating = canNavigateToRedirect;

  const shouldBlock = initializing || onboardingLoading || !rootNavigationState?.key;

  if (shouldBlock) {
    return (
      <View style={[styles.overlay, styles.overlaySolid]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  return (
    <>
      {children}
      {isNavigating ? (
        <View style={styles.overlay}>
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
