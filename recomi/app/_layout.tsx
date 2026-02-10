import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthGate, AuthProvider, useAuth } from '@/shared/context/auth';
import { firestore } from '@/shared/firebase/app';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <AuthGate>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <InviteBanner />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="signup" options={{ headerShown: false }} />
          </Stack>
        </ThemeProvider>
      </AuthGate>
    </AuthProvider>
  );
}

type InviteBannerState = {
  id: string;
  title: string;
  subtitle: string;
};

function InviteBanner() {
  const { user, initializing } = useAuth();
  const insets = useSafeAreaInsets();
  const [inviteBanner, setInviteBanner] = useState<InviteBannerState | null>(null);
  const lastInviteIdRef = useRef<string | null>(null);
  const didInitRef = useRef(false);

  useEffect(() => {
    if (!user?.uid || initializing) {
      setInviteBanner(null);
      lastInviteIdRef.current = null;
      didInitRef.current = false;
      return;
    }

    const invitesQuery = query(
      collection(firestore, 'invites'),
      where('toUserId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsub = onSnapshot(
      invitesQuery,
      (snapshot) => {
        if (snapshot.empty) return;
        const docSnap = snapshot.docs[0];
        if (!didInitRef.current) {
          lastInviteIdRef.current = docSnap.id;
          didInitRef.current = true;
          return;
        }
        if (docSnap.id === lastInviteIdRef.current) return;
        lastInviteIdRef.current = docSnap.id;
        const data = docSnap.data() as { placeLabel?: string; message?: string };
        const placeLine = data.placeLabel ? `Want to go to ${data.placeLabel}?` : undefined;
        setInviteBanner({
          id: docSnap.id,
          title: 'New invite',
          subtitle: placeLine ?? data.message ?? 'Open Notifications to view.',
        });
      },
      (error) => {
        console.warn("Failed to load invite banner", error);
        setInviteBanner(null);
      }
    );

    return () => {
      unsub();
    };
  }, [initializing, user?.uid]);

  useEffect(() => {
    if (!inviteBanner) return;
    const timer = setTimeout(() => setInviteBanner(null), 4000);
    return () => clearTimeout(timer);
  }, [inviteBanner]);

  if (!inviteBanner) return null;

  return (
    <Pressable
      onPress={() => setInviteBanner(null)}
      style={[styles.inviteBanner, { top: insets.top + 12 }]}
    >
      <View>
        <Text style={styles.inviteTitle}>{inviteBanner.title}</Text>
        <Text style={styles.inviteSubtitle}>{inviteBanner.subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inviteBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 200,
  },
  inviteTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  inviteSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#475569',
  },
});
