import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { firestore } from "@/shared/firebase/app";
import { useAuth } from "@/shared/context/auth";

type InviteItem = {
  id: string;
  type: "received" | "sent";
  title: string;
  subtitle: string;
  time: string;
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user, initializing } = useAuth();
  const [items, setItems] = React.useState<InviteItem[]>([]);

  React.useEffect(() => {
    if (!user?.uid || initializing) {
      setItems([]);
      return;
    }

    const sentQuery = query(
      collection(firestore, "invites"),
      where("fromUserId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const receivedQuery = query(
      collection(firestore, "invites"),
      where("toUserId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubSent = onSnapshot(
      sentQuery,
      (snapshot) => {
        const sent = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as { placeLabel?: string; message?: string; createdAt?: { toDate: () => Date } };
          const time = data.createdAt?.toDate?.() ?? new Date();
        return {
          id: `sent-${docSnap.id}`,
          type: "sent" as const,
          title: "Invite sent",
          subtitle: data.placeLabel ? `to ${data.placeLabel}` : data.message ?? "Invite sent",
          time: time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        });
        setItems((prev) => {
          const received = prev.filter((item) => item.type === "received");
          return [...sent, ...received].sort((a, b) => (a.time < b.time ? 1 : -1));
        });
      },
      (error) => {
        console.warn("Failed to load sent invites", error);
        setItems([]);
      }
    );

    const unsubReceived = onSnapshot(
      receivedQuery,
      (snapshot) => {
        const received = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as { placeLabel?: string; message?: string; createdAt?: { toDate: () => Date } };
          const time = data.createdAt?.toDate?.() ?? new Date();
        return {
          id: `received-${docSnap.id}`,
          type: "received" as const,
          title: "Invite received",
          subtitle: data.placeLabel ? `to ${data.placeLabel}` : data.message ?? "Invite received",
          time: time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        });
        setItems((prev) => {
          const sent = prev.filter((item) => item.type === "sent");
          return [...sent, ...received].sort((a, b) => (a.time < b.time ? 1 : -1));
        });
      },
      (error) => {
        console.warn("Failed to load received invites", error);
        setItems([]);
      }
    );

    return () => {
      unsubSent();
      unsubReceived();
    };
  }, [initializing, user?.uid]);
  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.subtitle}>Invites you send and receive</Text>
      </View>
      <FlatList
        data={items}
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
