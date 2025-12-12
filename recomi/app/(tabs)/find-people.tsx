import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  listUserProfiles,
  type ListUsersResult,
  type UserProfile,
} from "@/shared/api/users";
import type { SavedEntry } from "@/shared/context/savedLists";
import { useAuth } from "@/shared/context/auth";
import { SAFE_AREA_PADDING } from "@/constants/layout";

const SEARCH_DEBOUNCE_MS = 350;

type EnrichedUserProfile = UserProfile & {
  savedPlacesCount: number;
};

function countSavedPlaces(user: UserProfile): number {
  const entriesField = (user as any).entries;
  if (!Array.isArray(entriesField)) return 0;
  return entriesField.length;
}

export default function FindPeopleScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const searchInputRef = React.useRef<TextInput | null>(null);
  const safeTop = Math.max(insets.top, SAFE_AREA_PADDING.top);
  const safeBottom = Math.max(insets.bottom, SAFE_AREA_PADDING.bottom);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<EnrichedUserProfile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(true);

  const cursorRef = React.useRef<ListUsersResult["cursor"]>(null);
  const fetchingRef = React.useRef(false);
  const hasMoreRef = React.useRef(true);

  const fetchUsers = React.useCallback(
    async (mode: "reset" | "append" = "reset") => {
      if (mode === "append" && !hasMoreRef.current) return;
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      if (mode === "reset") {
        setLoading(true);
        setError(null);
        cursorRef.current = null;
        hasMoreRef.current = true;
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const normalizedQuery = query.trim();
        const result = await listUserProfiles({
          search: normalizedQuery.length ? normalizedQuery : undefined,
          excludeUid: user?.uid,
          cursor: mode === "append" ? cursorRef.current ?? undefined : undefined,
        });

        cursorRef.current = result.cursor;
        const nextHasMore = Boolean(result.cursor);
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);

        const enriched = result.users.map((user) => ({
          ...user,
          savedPlacesCount: countSavedPlaces(user),
        }));

        setResults((prev) => (mode === "append" ? [...prev, ...enriched] : enriched));
      } catch (err) {
        console.error("Failed to load users", err);
        setError(err instanceof Error ? err.message : "Unable to load people right now.");
      } finally {
        if (mode === "reset") {
          setLoading(false);
        }
        setRefreshing(false);
        setLoadingMore(false);
        fetchingRef.current = false;
      }
    },
    [query, user?.uid]
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      void fetchUsers("reset");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, fetchUsers]);

  const handleRefresh = React.useCallback(() => {
    setRefreshing(true);
    void fetchUsers("reset");
  }, [fetchUsers]);

  const handleEndReached = React.useCallback(() => {
    if (!loading && !loadingMore && hasMoreRef.current) {
      void fetchUsers("append");
    }
  }, [fetchUsers, loading, loadingMore]);

  const dismissKeyboard = React.useCallback(() => {
    Keyboard.dismiss();
    searchInputRef.current?.blur();
  }, []);

  const renderItem = React.useCallback(
    ({ item }: { item: EnrichedUserProfile }) => (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/user/${item.id}`)}
      >
        <View style={styles.avatarWrapper}>
          {item.photoURL ? (
            <Image source={{ uri: item.photoURL }} style={styles.avatar} />
          ) : (
            <View style={styles.fallbackAvatar}>
              <Text style={styles.fallbackAvatarText}>
                {(item.displayName ?? item.username ?? item.email ?? "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.displayName ?? item.username ?? "Unknown user"}</Text>
          {item.username ? <Text style={styles.cardHandle}>@{item.username}</Text> : null}
          {item.bio ? <Text style={styles.cardBio} numberOfLines={2}>{item.bio}</Text> : null}
          <Text style={styles.cardMeta}>
            {item.savedPlacesCount} {item.savedPlacesCount === 1 ? "place saved" : "places saved"}
          </Text>
        </View>
      </Pressable>
    ),
    [router]
  );

  const listEmpty = React.useMemo(() => {
    if (loading) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => fetchUsers("reset")} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.centerContent}>
        <Text style={styles.muted}>No people found yet.</Text>
      </View>
    );
  }, [loading, error, fetchUsers]);

  return (
    <View style={[styles.container, { paddingTop: safeTop, paddingBottom: safeBottom }]}>
      <View style={styles.searchWrapper}>
        <View style={styles.searchInputContainer}>
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search by username"
            placeholderTextColor="#94a3b8"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="done"
            onSubmitEditing={dismissKeyboard}
          />
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: safeBottom + 8 }]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={dismissKeyboard}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color="#0f172a" />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  searchWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchInputContainer: {
    flex: 1,
  },
  searchInput: {
    height: 44,
    borderRadius: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontSize: 16,
    color: "#0f172a",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#fff",
    marginBottom: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  avatarWrapper: {
    marginRight: 16,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  fallbackAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackAvatarText: {
    fontSize: 22,
    fontWeight: "600",
    color: "#475569",
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#0f172a",
  },
  cardHandle: {
    fontSize: 15,
    color: "#64748b",
    marginTop: 2,
  },
  cardBio: {
    fontSize: 15,
    color: "#1e293b",
    marginTop: 8,
  },
  cardMeta: {
    fontSize: 13,
    color: "#475569",
    marginTop: 6,
  },
  centerContent: {
    padding: 40,
    alignItems: "center",
  },
  muted: {
    color: "#94a3b8",
    fontSize: 15,
  },
  errorText: {
    color: "#b91c1c",
    textAlign: "center",
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#0f172a",
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
  },
  footer: {
    paddingVertical: 16,
  },
});
