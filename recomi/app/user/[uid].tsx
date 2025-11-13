import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, onSnapshot } from "firebase/firestore";

import { firestore } from "@/shared/firebase/app";
import { USERS_COLLECTION, followUser, getFollowCounts, isFollowing, type UserDocument, unfollowUser } from "@/shared/api/users";
import type { SavedEntry, SavedListDefinition } from "@/shared/context/savedLists";
import { useAuth } from "@/shared/context/auth";

type UserProfileData = UserDocument & {
  id: string;
};

export default function UserProfileScreen() {
  const { uid } = useLocalSearchParams<{ uid?: string | string[] }>();
  const resolvedUid = Array.isArray(uid) ? uid[0] : uid;
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = React.useState<boolean | null>(null);
  const [followStatusLoading, setFollowStatusLoading] = React.useState(false);
  const [followBusy, setFollowBusy] = React.useState(false);
  const [followError, setFollowError] = React.useState<string | null>(null);
  const [followersCount, setFollowersCount] = React.useState<number>(0);
  const [followingCount, setFollowingCount] = React.useState<number>(0);
  const [countsLoading, setCountsLoading] = React.useState(true);
  const [countsRefreshKey, setCountsRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!resolvedUid) {
      setError("No user specified.");
      setLoading(false);
      return;
    }

    const ref = doc(firestore, USERS_COLLECTION, resolvedUid);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          setProfile(null);
          setError("User not found.");
        } else {
          setProfile({ id: snapshot.id, ...(snapshot.data() as UserDocument) });
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load user profile", err);
        setError("Unable to load this profile right now.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [resolvedUid]);

  const isSelf = user?.uid === resolvedUid;
  const canFollow = Boolean(user && resolvedUid && !isSelf);

  const lists = React.useMemo(() => {
    if (!profile?.lists || !Array.isArray(profile.lists)) return [] as SavedListDefinition[];
    return profile.lists as SavedListDefinition[];
  }, [profile?.lists]);

  const entries = React.useMemo(() => {
    if (!profile?.entries || !Array.isArray(profile.entries)) return [] as SavedEntry[];
    return profile.entries as SavedEntry[];
  }, [profile?.entries]);

  const entriesByList = React.useMemo(() => {
    return entries.reduce<Record<string, SavedEntry[]>>((acc, entry) => {
      acc[entry.listId] = acc[entry.listId] ? [...acc[entry.listId], entry] : [entry];
      return acc;
    }, {});
  }, [entries]);

  const visibleLists = React.useMemo(() => {
    if (isSelf) return lists;
    return lists.filter((list) => list.visibility === "public");
  }, [isSelf, lists]);

  React.useEffect(() => {
    let active = true;
    const loadCounts = async () => {
      if (!resolvedUid) {
        if (active) {
          setFollowersCount(0);
          setFollowingCount(0);
          setCountsLoading(false);
        }
        return;
      }
      setCountsLoading(true);
      try {
        const counts = await getFollowCounts(resolvedUid);
        if (active) {
          setFollowersCount(counts.followers);
          setFollowingCount(counts.following);
        }
      } catch (err) {
        if (active) {
          console.error("Failed to load follow counts", err);
        }
      } finally {
        if (active) {
          setCountsLoading(false);
        }
      }
    };
    void loadCounts();
    return () => {
      active = false;
    };
  }, [resolvedUid, countsRefreshKey]);

  React.useEffect(() => {
    if (!canFollow || !user || !resolvedUid) {
      setIsFollowingUser(null);
      setFollowStatusLoading(false);
      return;
    }

    let cancelled = false;
    setFollowStatusLoading(true);
    setFollowError(null);
    isFollowing(user.uid, resolvedUid)
      .then((result) => {
        if (!cancelled) {
          setIsFollowingUser(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to check follow state", err);
          setFollowError("Unable to determine follow status.");
          setIsFollowingUser(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFollowStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canFollow, resolvedUid, user]);

  const handleFollowToggle = React.useCallback(async () => {
    if (!canFollow || !resolvedUid || !user) {
      setFollowError("Sign in to follow people.");
      return;
    }
    if (followBusy || followStatusLoading) return;

    const currentlyFollowing = Boolean(isFollowingUser);
    setFollowBusy(true);
    setFollowError(null);
    try {
      if (currentlyFollowing) {
        await unfollowUser(user.uid, resolvedUid);
        setIsFollowingUser(false);
      } else {
        await followUser(user.uid, resolvedUid);
        setIsFollowingUser(true);
      }
      setCountsRefreshKey((key) => key + 1);
    } catch (err) {
      console.error("Failed to update follow status", err);
      setFollowError(err instanceof Error ? err.message : "Unable to update follow status.");
    } finally {
      setFollowBusy(false);
    }
  }, [canFollow, followBusy, followStatusLoading, isFollowingUser, resolvedUid, user]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "User not found."}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        {profile.photoURL ? (
          <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
        ) : (
          <View style={styles.placeholderAvatar}>
            <Text style={styles.placeholderInitial}>
              {(profile.displayName ?? profile.username ?? profile.email ?? "?")
                .slice(0, 1)
                .toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.headerText}>
          <Text style={styles.displayName}>
            {profile.displayName ?? profile.username ?? "Unknown user"}
          </Text>
          {profile.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
          {profile.homeCity ? <Text style={styles.meta}>{profile.homeCity}</Text> : null}
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Followers" value={followersCount} />
        <Stat label="Following" value={followingCount} />
        <Stat label="Lists" value={visibleLists.length} />
      </View>
      {countsLoading ? <Text style={styles.countsHint}>Updating stats…</Text> : null}

      {canFollow ? (
        <View>
          <Pressable
            style={[
              styles.followButton,
              isFollowingUser ? styles.followButtonSecondary : styles.followButtonPrimary,
              (followBusy || followStatusLoading) && styles.followButtonDisabled,
            ]}
            disabled={followBusy || followStatusLoading}
            onPress={handleFollowToggle}
          >
            <Text
              style={isFollowingUser ? styles.followLabelSecondary : styles.followLabelPrimary}
            >
              {followStatusLoading ? "..." : isFollowingUser ? "Following" : "Follow"}
            </Text>
          </Pressable>
          {followError ? <Text style={styles.followError}>{followError}</Text> : null}
        </View>
      ) : null}

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Lists</Text>
        {!isSelf ? <Text style={styles.sectionSubtitle}>Only public lists are visible.</Text> : null}
      </View>

      {visibleLists.length === 0 ? (
        <Text style={styles.emptyState}>
          {isSelf ? "You haven't created any lists yet." : "No public lists to show."}
        </Text>
      ) : (
        visibleLists.map((list) => {
          const itemCount = entriesByList[list.id]?.length ?? 0;
          const badgeStyle = badgeColors[list.visibility ?? "public"];
          return (
            <View key={list.id} style={styles.listCard}>
              <View style={styles.listHeader}>
                <Text style={styles.listName}>{list.name}</Text>
                <Text style={[styles.badge, badgeStyle]}>
                  {list.visibility ?? "public"}
                </Text>
              </View>
              {list.description ? <Text style={styles.listDescription}>{list.description}</Text> : null}
              <Text style={styles.listMeta}>
                {itemCount} {itemCount === 1 ? "place" : "places"}
              </Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const badgeColors: Record<SavedListDefinition["visibility"], { color: string; backgroundColor: string }> = {
  public: { color: "#047857", backgroundColor: "rgba(4,120,87,0.12)" },
  followers: { color: "#7c2d12", backgroundColor: "rgba(124,45,18,0.12)" },
  private: { color: "#1d4ed8", backgroundColor: "rgba(29,78,216,0.12)" },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 20,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 16,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  placeholderAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderInitial: {
    fontSize: 32,
    fontWeight: "600",
    color: "#475569",
  },
  headerText: {
    flex: 1,
  },
  displayName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0f172a",
  },
  username: {
    fontSize: 16,
    color: "#475569",
    marginTop: 4,
  },
  meta: {
    color: "#64748b",
    marginTop: 8,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 16,
    backgroundColor: "#fff",
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  stat: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
  },
  statLabel: {
    marginTop: 4,
    fontSize: 13,
    color: "#64748b",
  },
  countsHint: {
    marginTop: -12,
    marginBottom: 8,
    textAlign: "right",
    fontSize: 12,
    color: "#94a3b8",
  },
  bio: {
    fontSize: 16,
    lineHeight: 22,
    color: "#1e293b",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#94a3b8",
  },
  emptyState: {
    fontSize: 15,
    color: "#94a3b8",
  },
  listCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
    marginBottom: 12,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  listName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  badge: {
    textTransform: "capitalize",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "600",
  },
  listDescription: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 8,
  },
  listMeta: {
    fontSize: 13,
    color: "#94a3b8",
  },
  followButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  followButtonPrimary: {
    backgroundColor: "#0f172a",
  },
  followButtonSecondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd5f5",
  },
  followButtonDisabled: {
    opacity: 0.6,
  },
  followLabelPrimary: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  followLabelSecondary: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
  },
  followError: {
    marginTop: 6,
    color: "#b91c1c",
    textAlign: "center",
  },
});
