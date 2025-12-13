import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { getAuth, initializeAuth, getReactNativePersistence } from "firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

type EnvValue = string | undefined;

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY as EnvValue,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN as EnvValue,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID as EnvValue,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET as EnvValue,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID as EnvValue,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID as EnvValue,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID as EnvValue,
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length) {
  console.warn(
    `Firebase config is missing values for: ${missingKeys.join(", ")}. ` +
      `Set EXPO_PUBLIC_FIREBASE_* environment variables before running the app.`
  );
}

// Reuse the existing Firebase app if it was already bootstrapped (e.g. during HMR).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance;
if (Platform.OS === "web") {
  authInstance = getAuth(app);
} else {
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (err) {
    // initializeAuth throws if HMR already created an instance; fall back to the existing one.
    const error = err as FirebaseError;
    if (error.code === "auth/already-initialized") {
      authInstance = getAuth(app);
    } else {
      throw err;
    }
  }
}

const db = getFirestore(app);

export const firebaseApp = app;
export const auth = authInstance;
export const firestore = db;
