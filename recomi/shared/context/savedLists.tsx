import React from "react"
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore"

import { firestore } from "../firebase/app"
import { useAuth } from "./auth"
import {
  PLACE_STATS_COLLECTION,
  PLACE_USER_SAVES_SUBCOLLECTION,
  coordsMatch,
  normalizePin,
  placeIdFromPin,
  type PlaceBucket,
} from "../utils/placeStats"

export type SavedListDefinition = {
  id: string
  name: string
  description?: string
  coverImage?: string
  savesCount?: number
  visibility: "private" | "followers" | "public"
}

export type SavedEntry = {
  listId: string
  listName: string
  bucket: "wishlist" | "favourite"
  pin: {
    lat: number
    lng: number
    label: string
    placeId?: string | null
  }
  savedAt: number
}

export type LikedListRef = {
  ownerId: string
  ownerDisplayName?: string | null
  ownerUsername?: string | null
  listId: string
  listName: string
  description?: string | null
  wishlist: SavedEntry[]
  favourite: SavedEntry[]
}

// Enumerated options for UI pickers so visibility rules stay in sync with Firestore.
export const LIST_VISIBILITY_OPTIONS: Array<{
  value: SavedListDefinition["visibility"]
  label: string
  helper: string
}> = [
  {
    value: "public",
    label: "Public",
    helper: "Visible to anyone with the link.",
  },
  {
    value: "followers",
    label: "Followers",
    helper: "Only people who follow you can see it.",
  },
  {
    value: "private",
    label: "Private",
    helper: "Only you can see this list.",
  },
]

const EMPTY_LIST_DEFINITIONS: SavedListDefinition[] = []

// Everything the saved-list experiences need in one provider value.
type SavedListsContextValue = {
  lists: SavedListDefinition[]
  entries: SavedEntry[]
  likedLists: LikedListRef[]
  likedListsVisible: boolean
  addEntry: (entry: SavedEntry) => void
  removeEntry: (listId: string, pin: SavedEntry["pin"]) => void
  addList: (name: string, visibility?: SavedListDefinition["visibility"]) => SavedListDefinition
  removeList: (listId: string) => void
  updateListCover: (listId: string, coverImage: string | null) => void
  likeList: (liked: LikedListRef) => void
  unlikeList: (ownerId: string, listId: string) => void
  setLikedListsVisibility: (visible: boolean) => void
  requestMapFocus: (entry: SavedEntry) => void
  mapFocusEntry: SavedEntry | null
  clearMapFocus: () => void
  loading: boolean
}

const SavedListsContext = React.createContext<SavedListsContextValue | undefined>(undefined)

// Synchronizes the signed-in user's lists/entries/likes with Firestore and exposes mutators.
export function SavedListsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [lists, setLists] = React.useState<SavedListDefinition[]>(EMPTY_LIST_DEFINITIONS)
  const [entries, setEntries] = React.useState<SavedEntry[]>([])
  const [likedLists, setLikedLists] = React.useState<LikedListRef[]>([])
  const [likedListsVisible, setLikedListsVisible] = React.useState(true)
  const [loading, setLoading] = React.useState(true)
  const isHydratedRef = React.useRef(false)

  // Re-subscribe any time the authenticated user changes.
  React.useEffect(() => {
    setLoading(true)
    isHydratedRef.current = false

    if (!user) {
      setLists(EMPTY_LIST_DEFINITIONS)
      setEntries([])
      setLikedLists([])
      setLikedListsVisible(true)
      setTimeout(() => {
        isHydratedRef.current = true
      }, 0)
      setLoading(false)
      return
    }

    const userRef = doc(firestore, "users", user.uid)
    const listsRef = collection(firestore, "users", user.uid, "lists")
    const legacyListsRef = { current: [] as SavedListDefinition[] }
    const entriesRef = { current: [] as SavedEntry[] }
    const migratedRef = { current: false }
    let userLoaded = false
    let listsLoaded = false

    const maybeFinish = () => {
      if (userLoaded && listsLoaded) {
        isHydratedRef.current = true
        setLoading(false)
      }
    }

    const unsubUser = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as {
            lists?: SavedListDefinition[]
            entries?: SavedEntry[]
            likedLists?: LikedListRef[]
            likedListsVisible?: boolean
          }

          const rawLists = Array.isArray(data.lists) ? data.lists : []
          legacyListsRef.current = rawLists.map((list) => ({
            ...list,
            visibility: list.visibility ?? "public",
          }))

          const nextEntries = Array.isArray(data.entries) ? data.entries : []
          entriesRef.current = nextEntries
          setEntries(nextEntries)
          const rawLiked = Array.isArray(data.likedLists) ? (data.likedLists as LikedListRef[]) : []
          setLikedLists(
            rawLiked.map((item) => ({
              ...item,
              wishlist: Array.isArray(item.wishlist) ? item.wishlist : [],
              favourite: Array.isArray(item.favourite) ? item.favourite : [],
            })),
          )
          setLikedListsVisible(
            typeof data.likedListsVisible === "boolean" ? data.likedListsVisible : true,
          )
        } else {
          entriesRef.current = []
          setEntries([])
          setLikedLists([])
          setLikedListsVisible(true)
        }
        userLoaded = true
        maybeFinish()
      },
      (error) => {
        console.error("Failed to load saved lists", error)
        setEntries([])
        setLikedLists([])
        setLikedListsVisible(true)
        userLoaded = true
        maybeFinish()
      }
    )

    const unsubLists = onSnapshot(
      listsRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const nextLists = snapshot.docs.map((docSnap) => {
            const data = docSnap.data() as Omit<SavedListDefinition, "id">
            return {
              id: docSnap.id,
              name: data.name ?? "Untitled",
              description: data.description,
              coverImage: data.coverImage,
              savesCount: typeof data.savesCount === "number" ? data.savesCount : 0,
              visibility: data.visibility ?? "public",
            } as SavedListDefinition
          })
          setLists(nextLists)
        } else if (legacyListsRef.current.length) {
          setLists(legacyListsRef.current)
          if (!migratedRef.current) {
            migratedRef.current = true
            void Promise.all(
              legacyListsRef.current.map((list) =>
                setDoc(doc(firestore, "users", user.uid, "lists", list.id), {
                  name: list.name,
                  description: list.description ?? null,
                  coverImage: list.coverImage ?? null,
                  visibility: list.visibility ?? "public",
                  savesCount: list.savesCount ?? 0,
                  createdAt: serverTimestamp(),
                })
              )
            )
          }
        } else if (entriesRef.current.length) {
          const byId = new Map<string, SavedListDefinition>()
          entriesRef.current.forEach((entry) => {
            if (!entry.listId) return
            if (byId.has(entry.listId)) return
            byId.set(entry.listId, {
              id: entry.listId,
              name: entry.listName || "Untitled",
              visibility: "public",
              savesCount: 0,
            })
          })
          const derived = Array.from(byId.values())
          setLists(derived)
          if (!migratedRef.current) {
            migratedRef.current = true
            void Promise.all(
              derived.map((list) =>
                setDoc(doc(firestore, "users", user.uid, "lists", list.id), {
                  name: list.name,
                  description: null,
                  coverImage: null,
                  visibility: list.visibility,
                  savesCount: 0,
                  createdAt: serverTimestamp(),
                })
              )
            )
          }
        } else {
          setLists(EMPTY_LIST_DEFINITIONS)
        }
        listsLoaded = true
        maybeFinish()
      },
      (error) => {
        console.error("Failed to load list definitions", error)
        setLists(EMPTY_LIST_DEFINITIONS)
        listsLoaded = true
        maybeFinish()
      }
    )

    return () => {
      unsubUser()
      unsubLists()
    }
  }, [user])

  const persistQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const currentUserIdRef = React.useRef<string | null>(null)

  const getPinAggregateStatus = React.useCallback((source: SavedEntry[], pin: SavedEntry["pin"]): PlaceBucket => {
    const matches = source.filter((entry) => coordsMatch(entry.pin, pin))
    if (matches.some((entry) => entry.bucket === "favourite")) {
      return "favourite"
    }
    if (matches.some((entry) => entry.bucket === "wishlist")) {
      return "wishlist"
    }
    return "none"
  }, [])

  const updatePlaceStats = React.useCallback(
    async (pin: SavedEntry["pin"], previousStatus: PlaceBucket, nextStatus: PlaceBucket) => {
      if (!user || previousStatus === nextStatus) return
      const placeId = placeIdFromPin(pin)
      const placeRef = doc(firestore, PLACE_STATS_COLLECTION, placeId)
      const userSaveRef = doc(firestore, PLACE_STATS_COLLECTION, placeId, PLACE_USER_SAVES_SUBCOLLECTION, user.uid)
      const normalizedPin = normalizePin(pin)

      await runTransaction(firestore, async (tx) => {
        const snapshot = await tx.get(placeRef)
        const data = snapshot.exists() ? snapshot.data() : {}
        const currentWishlist = typeof data?.wishlistCount === "number" ? data.wishlistCount : 0
        const currentFavourite = typeof data?.favouriteCount === "number" ? data.favouriteCount : 0
        let wishlistCount = currentWishlist
        let favouriteCount = currentFavourite

        if (previousStatus === "wishlist") {
          wishlistCount = Math.max(0, wishlistCount - 1)
        } else if (previousStatus === "favourite") {
          favouriteCount = Math.max(0, favouriteCount - 1)
        }

        if (nextStatus === "wishlist") {
          wishlistCount += 1
        } else if (nextStatus === "favourite") {
          favouriteCount += 1
        }

        tx.set(
          placeRef,
          {
            wishlistCount,
            favouriteCount,
            lat: normalizedPin.lat,
            lng: normalizedPin.lng,
            label: normalizedPin.label ?? null,
            placeId: normalizedPin.placeId ?? null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )

        if (nextStatus === "none") {
          tx.delete(userSaveRef)
        } else {
          tx.set(
            userSaveRef,
            {
              userId: user.uid,
              bucket: nextStatus,
              savedAt: serverTimestamp(),
            },
            { merge: true }
          )
        }
      })
    },
    [user]
  )

  React.useEffect(() => {
    currentUserIdRef.current = user?.uid ?? null
  }, [user?.uid])

  // Push the canonical version of entries/likes into Firestore.
  const persist = React.useCallback(
    async (
      nextEntries: SavedEntry[] = entries,
      nextLikedLists: LikedListRef[] = likedLists,
      nextLikedListsVisible: boolean = likedListsVisible,
    ) => {
      if (!user || !isHydratedRef.current) return
      const targetUid = user.uid
      const payload = {
        entries: nextEntries,
        likedLists: nextLikedLists,
        likedListsVisible: nextLikedListsVisible,
        savedPlacesCount: nextEntries.length,
        updatedAt: serverTimestamp(),
      }
      const run = async () => {
        if (currentUserIdRef.current !== targetUid) {
          return
        }
        try {
          await setDoc(doc(firestore, "users", targetUid), payload, { merge: true })
        } catch (error) {
          console.error("Failed to persist saved lists", error)
        }
      }
      persistQueueRef.current = persistQueueRef.current
        .catch(() => {})
        .then(run)
    },
    [entries, likedLists, likedListsVisible, user]
  )

  // Merge a pin into the user's collection, deduping by lat/lng/list.
  const addEntry = React.useCallback(
    (entry: SavedEntry) => {
      setEntries((prev) => {
        const previousStatus = getPinAggregateStatus(prev, entry.pin)
        const next = prev.filter(
          (existing) =>
            !(
              existing.listId === entry.listId &&
              Math.abs(existing.pin.lat - entry.pin.lat) < 1e-8 &&
              Math.abs(existing.pin.lng - entry.pin.lng) < 1e-8
            )
        )
        const updated = [...next, entry]
        void persist(updated)
        void updatePlaceStats(entry.pin, previousStatus, getPinAggregateStatus(updated, entry.pin))
        return updated
      })
    },
    [getPinAggregateStatus, lists, persist, updatePlaceStats]
  )

  // Remove a pin from a list by matching both listId and coordinates.
  const removeEntry = React.useCallback(
    (listId: string, pin: SavedEntry["pin"]) => {
      setEntries((prev) => {
        const previousStatus = getPinAggregateStatus(prev, pin)
        const updated = prev.filter(
          (existing) =>
            !(
              existing.listId === listId &&
              coordsMatch(existing.pin, pin)
            )
        )
        void persist(updated)
        void updatePlaceStats(pin, previousStatus, getPinAggregateStatus(updated, pin))
        return updated
      })
    },
    [getPinAggregateStatus, lists, persist, updatePlaceStats]
  )

  // Create new list metadata locally and persist it after basic validation.
  const addList = React.useCallback(
    (name: string, visibility: SavedListDefinition["visibility"] = "private") => {
      const trimmed = name.trim()
      if (!trimmed) {
        throw new Error("List name must not be empty")
      }
      if (!user) {
        throw new Error("You must be signed in to create lists")
      }

      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const definition: SavedListDefinition = {
        id,
        name: trimmed,
        visibility,
        savesCount: 0,
      }

      setLists((prev) => {
        return [...prev, definition]
      })
      void setDoc(doc(firestore, "users", user.uid, "lists", id), {
        name: trimmed,
        visibility,
        description: null,
        coverImage: null,
        savesCount: 0,
        createdAt: serverTimestamp(),
      })

      return definition
    },
    [user]
  )

  // Strip a list plus its entries in one shot, then persist both arrays.
  const removeList = React.useCallback(
    (listId: string) => {
      if (user?.uid) {
        void deleteDoc(doc(firestore, "users", user.uid, "lists", listId))
      }
      setLists((prev) => {
        const updatedLists = prev.filter((list) => list.id !== listId)
        setEntries((prevEntries) => {
          const updatedEntries = prevEntries.filter((entry) => entry.listId !== listId)
          void persist(updatedEntries)
          return updatedEntries
        })
        return updatedLists
      })
    },
    [persist, user?.uid]
  )

  const updateListCover = React.useCallback(
    (listId: string, coverImage: string | null) => {
      if (user?.uid) {
        void setDoc(
          doc(firestore, "users", user.uid, "lists", listId),
          { coverImage: coverImage ?? null, updatedAt: serverTimestamp() },
          { merge: true }
        )
      }
      setLists((prev) => {
        const updated = prev.map((list) =>
          list.id === listId ? { ...list, coverImage: coverImage ?? undefined } : list
        )
        return updated
      })
    },
    [user?.uid]
  )

  const [mapFocusEntry, setMapFocusEntry] = React.useState<SavedEntry | null>(null)

  // Let map consumers know which entry should be highlighted.
  const requestMapFocus = React.useCallback((entry: SavedEntry) => {
    setMapFocusEntry(entry)
  }, [])

  // Consumers call this after handling the map focus request.
  const clearMapFocus = React.useCallback(() => {
    setMapFocusEntry(null)
  }, [])

  // Cache other users' public lists the viewer has liked.
  const likeList = React.useCallback(
    (liked: LikedListRef) => {
      if (!user?.uid) {
        throw new Error("You must be signed in to like lists")
      }
      const likeId = `${liked.ownerId}_${liked.listId}_${user.uid}`
      void setDoc(doc(firestore, "listLikes", likeId), {
        ownerId: liked.ownerId,
        listId: liked.listId,
        saverId: user.uid,
        createdAt: serverTimestamp(),
      })
      setLikedLists((prev) => {
        if (prev.some((entry) => entry.ownerId === liked.ownerId && entry.listId === liked.listId)) {
          return prev
        }
        const updated = [...prev, liked]
        void persist(entries, updated)
        return updated
      })
    },
    [entries, lists, persist, user?.uid]
  )

  const unlikeList = React.useCallback(
    (ownerId: string, listId: string) => {
      if (user?.uid) {
        const likeId = `${ownerId}_${listId}_${user.uid}`
        void deleteDoc(doc(firestore, "listLikes", likeId))
      }
      setLikedLists((prev) => {
        const updated = prev.filter((entry) => !(entry.ownerId === ownerId && entry.listId === listId))
        if (updated.length === prev.length) {
          return prev
        }
        void persist(entries, updated)
        return updated
      })
    },
    [entries, lists, persist, user?.uid]
  )

  // Toggle whether the viewer exposes their liked lists to others.
  const setLikedListsVisibilityValue = React.useCallback(
    (visible: boolean) => {
      setLikedListsVisible((prev) => {
        if (prev === visible) return prev
        void persist(entries, likedLists, visible)
        return visible
      })
    },
    [entries, likedLists, lists, persist]
  )

  // Memoize context value so consumers only rerender on relevant changes.
  const value = React.useMemo(
    () => ({
      lists,
      entries,
      addEntry,
      removeEntry,
      addList,
      removeList,
      updateListCover,
      likedLists,
      likedListsVisible,
      likeList,
      unlikeList,
      setLikedListsVisibility: setLikedListsVisibilityValue,
      requestMapFocus,
      mapFocusEntry,
      clearMapFocus,
      loading,
    }),
    [
      lists,
      entries,
      addEntry,
      removeEntry,
      addList,
      removeList,
      updateListCover,
      likedLists,
      likedListsVisible,
      likeList,
      unlikeList,
      setLikedListsVisibilityValue,
      requestMapFocus,
      mapFocusEntry,
      clearMapFocus,
      loading,
    ]
  )

  return <SavedListsContext.Provider value={value}>{children}</SavedListsContext.Provider>
}

export function useSavedLists() {
  const context = React.useContext(SavedListsContext)
  if (!context) {
    throw new Error("useSavedLists must be used within a SavedListsProvider")
  }
  return context
}
