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

type SavedListsContextValue = {
  lists: SavedListDefinition[]
  entries: SavedEntry[]
  addEntry: (entry: SavedEntry) => void
  removeEntry: (listId: string, pin: SavedEntry["pin"]) => void
  addList: (name: string, visibility?: SavedListDefinition["visibility"]) => SavedListDefinition
  removeList: (listId: string) => void
  requestMapFocus: (entry: SavedEntry) => void
  mapFocusEntry: SavedEntry | null
  clearMapFocus: () => void
  loading: boolean
}

const SavedListsContext = React.createContext<SavedListsContextValue | undefined>(undefined)

export function SavedListsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [lists, setLists] = React.useState<SavedListDefinition[]>(EMPTY_LIST_DEFINITIONS)
  const [entries, setEntries] = React.useState<SavedEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const isHydratedRef = React.useRef(false)

  React.useEffect(() => {
    setLoading(true)
    isHydratedRef.current = false

    if (!user) {
    setLists(EMPTY_LIST_DEFINITIONS)
    setEntries([])
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
        } else {
          setLists(EMPTY_LIST_DEFINITIONS)
          setEntries([])
        }

        isHydratedRef.current = true
        setLoading(false)
      },
      (error) => {
        console.error("Failed to load saved lists", error)
        setLists(INITIAL_LIST_DEFINITIONS)
        setEntries([])
        isHydratedRef.current = true
        setLoading(false)
      }
    )

    return unsubscribe
  }, [user])

  const persist = React.useCallback(
    async (nextLists: SavedListDefinition[], nextEntries: SavedEntry[]) => {
      if (!user || !isHydratedRef.current) return
      try {
        await setDoc(
          doc(firestore, "users", user.uid),
          {
            lists: nextLists,
            entries: nextEntries,
            updatedAt: serverTimestamp(),
          },
          { merge: false }
        )
      } catch (error) {
        console.error("Failed to persist saved lists", error)
      }
    },
    [user]
  )

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

  const requestMapFocus = React.useCallback((entry: SavedEntry) => {
    setMapFocusEntry(entry)
  }, [])

  const clearMapFocus = React.useCallback(() => {
    setMapFocusEntry(null)
  }, [])

  const value = React.useMemo(
    () => ({
      lists,
      entries,
      addEntry,
      removeEntry,
      addList,
      removeList,
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
