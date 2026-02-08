import React from "react"
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore"

import { firestore } from "../firebase/app"
import { useAuth } from "./auth"

export type SavedListDefinition = {
  id: string
  name: string
  description?: string
  coverImage?: string
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

    const ref = doc(firestore, "users", user.uid)

    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as {
            lists?: SavedListDefinition[]
            entries?: SavedEntry[]
            likedLists?: LikedListRef[]
            likedListsVisible?: boolean
          }

          const rawLists = Array.isArray(data.lists) ? data.lists : []
          const nextLists = rawLists.map(
            (list) => ({
              ...list,
              visibility: list.visibility ?? "public",
            })
          )

          setLists(nextLists)
          setEntries(Array.isArray(data.entries) ? data.entries : [])
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
          setLists(EMPTY_LIST_DEFINITIONS)
          setEntries([])
          setLikedLists([])
          setLikedListsVisible(true)
        }

        isHydratedRef.current = true
        setLoading(false)
      },
      (error) => {
        console.error("Failed to load saved lists", error)
        setLists(EMPTY_LIST_DEFINITIONS)
        setEntries([])
        setLikedLists([])
        setLikedListsVisible(true)
        isHydratedRef.current = true
        setLoading(false)
      }
    )

    return unsubscribe
  }, [user])

  const persistQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const currentUserIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    currentUserIdRef.current = user?.uid ?? null
  }, [user?.uid])

  // Push the canonical version of lists/entries/likes into Firestore.
  const persist = React.useCallback(
    async (
      nextLists: SavedListDefinition[] = lists,
      nextEntries: SavedEntry[] = entries,
      nextLikedLists: LikedListRef[] = likedLists,
      nextLikedListsVisible: boolean = likedListsVisible,
    ) => {
      if (!user || !isHydratedRef.current) return
      const targetUid = user.uid
      const payload = {
        lists: nextLists,
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
    [entries, likedLists, likedListsVisible, lists, user]
  )

  // Merge a pin into the user's collection, deduping by lat/lng/list.
  const addEntry = React.useCallback(
    (entry: SavedEntry) => {
      setEntries((prev) => {
        const next = prev.filter(
          (existing) =>
            !(
              existing.listId === entry.listId &&
              Math.abs(existing.pin.lat - entry.pin.lat) < 1e-8 &&
              Math.abs(existing.pin.lng - entry.pin.lng) < 1e-8
            )
        )
        const updated = [...next, entry]
        void persist(lists, updated)
        return updated
      })
    },
    [lists, persist]
  )

  // Remove a pin from a list by matching both listId and coordinates.
  const removeEntry = React.useCallback(
    (listId: string, pin: SavedEntry["pin"]) => {
      setEntries((prev) => {
        const updated = prev.filter(
          (existing) =>
            !(
              existing.listId === listId &&
              Math.abs(existing.pin.lat - pin.lat) < 1e-8 &&
              Math.abs(existing.pin.lng - pin.lng) < 1e-8
            )
        )
        void persist(lists, updated)
        return updated
      })
    },
    [lists, persist]
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

      const definition: SavedListDefinition = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        visibility,
      }

      setLists((prev) => {
        const updated = [...prev, definition]
        void persist(updated, entries)
        return updated
      })

      return definition
    },
    [entries, persist, user]
  )

  // Strip a list plus its entries in one shot, then persist both arrays.
  const removeList = React.useCallback(
    (listId: string) => {
      setLists((prev) => {
        const updatedLists = prev.filter((list) => list.id !== listId)
        setEntries((prevEntries) => {
          const updatedEntries = prevEntries.filter((entry) => entry.listId !== listId)
          void persist(updatedLists, updatedEntries)
          return updatedEntries
        })
        return updatedLists
      })
    },
    [persist]
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
      setLikedLists((prev) => {
        if (prev.some((entry) => entry.ownerId === liked.ownerId && entry.listId === liked.listId)) {
          return prev
        }
        const updated = [...prev, liked]
        void persist(lists, entries, updated)
        return updated
      })
    },
    [entries, lists, persist]
  )

  const unlikeList = React.useCallback(
    (ownerId: string, listId: string) => {
      setLikedLists((prev) => {
        const updated = prev.filter((entry) => !(entry.ownerId === ownerId && entry.listId === listId))
        if (updated.length === prev.length) {
          return prev
        }
        void persist(lists, entries, updated)
        return updated
      })
    },
    [entries, lists, persist]
  )

  // Toggle whether the viewer exposes their liked lists to others.
  const setLikedListsVisibilityValue = React.useCallback(
    (visible: boolean) => {
      setLikedListsVisible((prev) => {
        if (prev === visible) return prev
        void persist(lists, entries, likedLists, visible)
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
