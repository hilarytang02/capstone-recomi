import React from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { firestore } from "@/shared/firebase/app";
import { useAuth } from "@/shared/context/auth";
import { USERS_COLLECTION } from "@/shared/api/users";

type InviteItem = {
  id: string;
  type: "received" | "sent";
  title: string;
  createdAt: Date;
  counterpartyId: string;
  counterpartyName: string | null;
  counterpartyUsername: string | null;
};

type UserProfileLite = {
  id: string;
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatInviteTime = (value: Date) => {
  const now = new Date();
  if (isSameDay(value, now)) {
    return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now.getTime() - DAY_IN_MS);
  if (isSameDay(value, yesterday)) {
    return `Yesterday ${value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  const diffDays = Math.floor((now.getTime() - value.getTime()) / DAY_IN_MS);
  if (diffDays < 7) {
    return `${value.toLocaleDateString([], { weekday: "long" })} ${value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `${value.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const getUserLabel = (profile?: UserProfileLite | null) => {
  if (!profile) return "Unknown";
  if (profile.username) return `@${profile.username}`;
  if (profile.displayName) return profile.displayName;
  return "Unknown";
};

const getInitials = (label: string) => {
  const cleaned = label.replace(/^@/, "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user, initializing } = useAuth();
  const [sentItems, setSentItems] = React.useState<InviteItem[]>([]);
  const [receivedItems, setReceivedItems] = React.useState<InviteItem[]>([]);
  const [activeTab, setActiveTab] = React.useState<InviteItem["type"]>("received");
  const [profilesById, setProfilesById] = React.useState<Record<string, UserProfileLite>>({});

  const ensureProfiles = React.useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !profilesById[id]);
    if (!missing.length) return;
    const updates: Record<string, UserProfileLite> = {};
    await Promise.all(
      missing.map(async (id) => {
        const snap = await getDoc(doc(firestore, USERS_COLLECTION, id));
        const data = snap.exists()
          ? (snap.data() as { displayName?: string | null; username?: string | null; photoURL?: string | null })
          : {};
        updates[id] = {
          id,
          displayName: data.displayName ?? null,
          username: data.username ?? null,
          photoURL: data.photoURL ?? null,
        };
      })
    );
    setProfilesById((prev) => ({ ...prev, ...updates }));
  }, [profilesById]);

  const buildItem = React.useCallback(
    (docId: string, type: InviteItem["type"], data: { placeLabel?: string; message?: string; createdAt?: { toDate: () => Date }; fromUserId?: string; toUserId?: string }) => {
      const createdAt = data.createdAt?.toDate?.() ?? new Date();
      const counterpartyId = type === "received" ? data.fromUserId ?? "" : data.toUserId ?? "";
      const profile = counterpartyId ? profilesById[counterpartyId] : null;
      return {
        id: `${type}-${docId}`,
        type,
        title: data.placeLabel ?? "Invite",
        createdAt,
        counterpartyId,
        counterpartyName: profile?.displayName ?? null,
        counterpartyUsername: profile?.username ?? null,
      };
    },
    [profilesById]
  );

  React.useEffect(() => {
    if (!user?.uid || initializing) {
      setSentItems([]);
      setReceivedItems([]);
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
          const data = docSnap.data() as {
            placeLabel?: string;
            message?: string;
            createdAt?: { toDate: () => Date };
            fromUserId?: string;
            toUserId?: string;
          };
          return buildItem(docSnap.id, "sent", data);
        });
        setSentItems(sent.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
        const ids = sent.map((item) => item.counterpartyId).filter(Boolean);
        void ensureProfiles(ids);
      },
      (error) => {
        console.warn("Failed to load sent invites", error);
        setSentItems([]);
      }
    );

    const unsubReceived = onSnapshot(
      receivedQuery,
      (snapshot) => {
        const received = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as {
            placeLabel?: string;
            message?: string;
            createdAt?: { toDate: () => Date };
            fromUserId?: string;
            toUserId?: string;
          };
          return buildItem(docSnap.id, "received", data);
        });
        setReceivedItems(received.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
        const ids = received.map((item) => item.counterpartyId).filter(Boolean);
        void ensureProfiles(ids);
      },
      (error) => {
        console.warn("Failed to load received invites", error);
        setReceivedItems([]);
      }
    );

    return () => {
      unsubSent();
      unsubReceived();
    };
  }, [initializing, user?.uid]);

  React.useEffect(() => {
    if (!sentItems.length && !receivedItems.length) return;
    const ids = [
      ...sentItems.map((item) => item.counterpartyId),
      ...receivedItems.map((item) => item.counterpartyId),
    ].filter(Boolean);
    void ensureProfiles(ids);
  }, [ensureProfiles, receivedItems, sentItems]);

  const items = activeTab === "received" ? receivedItems : sentItems;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
      </View>
      <View style={styles.tabs}>
        <Pressable
          onPress={() => setActiveTab("received")}
          style={[styles.tab, activeTab === "received" && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === "received" && styles.tabTextActive]}>Invite received</Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("sent")}
          style={[styles.tab, activeTab === "sent" && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === "sent" && styles.tabTextActive]}>Invite sent</Text>
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const profile = profilesById[item.counterpartyId];
          const label = getUserLabel(profile);
          return (
            <Pressable style={styles.card}>
              <View style={styles.avatarWrap}>
                {profile?.photoURL ? (
                  <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarText}>{getInitials(label)}</Text>
                  </View>
                )}
              </View>
              <View style={styles.textBlock}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSubtitle}>
                  {item.type === "received" ? "From " : "To "}
                  {label}
                </Text>
              </View>
              <Text style={styles.time}>{formatInviteTime(item.createdAt)}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No invites yet</Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === "received"
                ? "Invites you receive will show here."
                : "Invites you send will show here."}
            </Text>
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
    fontSize: 28,
    fontWeight: "700",
    color: "#0f172a",
  },
  tabs: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
    backgroundColor: "#e2e8f0",
    borderRadius: 16,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#0f172a",
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
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#cbd5f5",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1e293b",
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
