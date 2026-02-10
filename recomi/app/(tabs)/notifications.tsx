import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MOCK_NOTIFICATIONS = [
  {
    id: "n1",
    type: "received",
    title: "Jamie invited you",
    subtitle: "Wants to go to Hysan Place",
    time: "2m",
  },
  {
    id: "n2",
    type: "sent",
    title: "Invite sent to Amina",
    subtitle: "Let’s try Bakehouse",
    time: "12m",
  },
  {
    id: "n3",
    type: "received",
    title: "Alex invited you",
    subtitle: "Dinner at Yardbird?",
    time: "1h",
  },
  {
    id: "n4",
    type: "sent",
    title: "Invite sent to Chris",
    subtitle: "Weekend coffee",
    time: "3h",
  },
];

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.subtitle}>Invites you send and receive</Text>
      </View>
      <FlatList
        data={MOCK_NOTIFICATIONS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <View style={styles.iconWrap}>
              <FontAwesome
                name={item.type === "received" ? "paper-plane" : "send"}
                size={16}
                color={item.type === "received" ? "#0ea5e9" : "#0f172a"}
              />
            </View>
            <View style={styles.textBlock}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
            </View>
            <Text style={styles.time}>{item.time}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No invites yet</Text>
            <Text style={styles.emptySubtitle}>Invites you send or receive will show here.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
  },
  list: {
    gap: 12,
    paddingBottom: 40,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  textBlock: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  cardSubtitle: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  time: {
    fontSize: 11,
    color: "#94a3b8",
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  emptySubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 6,
  },
});
