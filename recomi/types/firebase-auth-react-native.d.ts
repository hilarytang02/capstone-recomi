declare module "firebase/auth" {
  // The React Native persistence helper isn't typed in firebase v11, so we declare it here.
  export function getReactNativePersistence(storage: unknown): unknown;
}
