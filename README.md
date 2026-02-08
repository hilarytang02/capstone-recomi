# Recomi Mobile App

Recomi is an Expo Router + React Native application for discovering, saving, and sharing local recommendations. The project bundles the consumer app alongside Firebase Cloud Functions and Firestore rules so everything needed to run the product locally is checked into this repository.

## Requirements

- Node.js 18+ (matches Expo SDK 54 support)
- npm 9+ (ships with recent Node versions)
- Xcode 15 / Android Studio Giraffe or newer for native builds
- Firebase project with the following enabled:
  - Authentication (Google + Email/Password providers)
  - Firestore Database
  - Hosting (used for email links if enabled later)
- Environment variables defined for Expo (see `app.json`):
  - `EXPO_PUBLIC_FIREBASE_*`
  - `EXPO_PUBLIC_GOOGLE_*`

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment variables**
   - Copy the values from your Firebase project into `.env` or export them in your shell before running `npx expo start`.
3. **(Native builds)** Prebuild and run a dev client if you need to test native modules such as AsyncStorage:
   ```bash
   npx expo prebuild
   npx expo run:ios    # or: npx expo run:android
   ```
   After the build succeeds, start Metro with `npx expo start --dev-client` and open the project from the Expo Go replacement you just installed.

## Running the app

- **Development (Expo Go or dev client)**
  ```bash
  npx expo start
  # press i for iOS simulator, a for Android emulator, or scan the QR code for device testing
  ```
- **Standalone native build**
  ```bash
  npx expo prebuild
  npx expo run:ios    # deploys to simulator/device
  ```
  For CI-ready binaries use EAS Build (`eas build --platform ios` / `android`).

## Testing

Jest is configured for unit tests (see `jest.config.js` and `jest.setup.ts`):

```bash
npm test             # runs Jest in watch mode
npx jest --runInBand # useful for CI
```

At the moment only module-level tests exist; run the suite before submitting changes that touch shared utilities or contexts.

## Project structure

```
recomi/
├── app/                     # Expo Router segments (tabs, auth screens, onboarding, etc.)
│   ├── (tabs)/              # Bottom-tab routes (map, profile, find-people)
│   ├── onboarding.tsx
│   ├── login.tsx / signup.tsx / welcome.tsx
│   └── user/[uid].tsx       # Public profile view
├── components/              # Shared UI primitives (MapView wrapper, PinDetailSheet…)
├── constants/               # Styling + layout constants
├── shared/
│   ├── api/                 # Firestore + Auth helpers (users, follows, onboarding)
│   ├── context/             # React contexts (auth, saved lists)
│   └── firebase/            # Firebase initialization (Auth + Firestore)
├── recomi/functions/        # Firebase Cloud Functions (cleanup triggers, etc.)
├── assets/                  # Fonts/images bundled with the app
├── types/                   # Global TypeScript declarations (e.g., firebase-auth-react-native.d.ts)
├── firestore.rules          # Firestore security rules (deploy via the Firebase CLI)
├── package.json             # Dependencies + npm scripts
├── tsconfig.json            # TypeScript project config (path aliases, strictness)
└── README.md                # You are here
```

## Useful scripts

- `npm run start` – launches Metro/Expo Router
- `npm run ios` / `npm run android` – shortcut to `expo run:ios|android`
- `npm run test` – Jest suite

Refer to `package.json` for the full list.

## Firebase deployment (optional)

If you make changes to `firestore.rules` or `recomi/functions/`, use the Firebase CLI:

```bash
npx firebase login
npx firebase use <project-id>
npx firebase deploy --only firestore:rules
npx firebase deploy --only functions
```

Keep your `.env` secrets out of source control and follow the comments inside the shared contexts for implementation details.
