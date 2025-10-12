import { Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Coming soon.</Text>
      <Text style={styles.body}>
        We&apos;ll use this space to show your saved lists, recent activity, and controls for sharing
        recommendations with friends. For now, use the map tab to explore and drop pins. Any features
        we add there can surface here once the social graph is ready.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#f8fafc',
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
});
