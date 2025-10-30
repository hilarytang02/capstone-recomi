import React from "react"

export type SavedListDefinition = {
  id: string
  name: string
  description?: string
  coverImage?: string
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

const INITIAL_LIST_DEFINITIONS: SavedListDefinition[] = [
  { id: "1", name: "Weekend Brunch Spots" },
  { id: "2", name: "Coffee Crawl" },
  { id: "3", name: "Date Night Ideas" },
  { id: "4", name: "Bucket List Cities" },
  { id: "5", name: "Friend Recs" },
  { id: "6", name: "Hidden Gems" },
]

type SavedListsContextValue = {
  lists: SavedListDefinition[]
  entries: SavedEntry[]
  addEntry: (entry: SavedEntry) => void
  removeEntry: (listId: string, pin: SavedEntry["pin"]) => void
  addList: (name: string) => SavedListDefinition
  removeList: (listId: string) => void
}

const SavedListsContext = React.createContext<SavedListsContextValue | undefined>(undefined)

export function SavedListsProvider({ children }: { children: React.ReactNode }) {
  const [lists, setLists] = React.useState<SavedListDefinition[]>(INITIAL_LIST_DEFINITIONS)
  const [entries, setEntries] = React.useState<SavedEntry[]>([])

  const addEntry = React.useCallback((entry: SavedEntry) => {
    setEntries((prev) => {
      const next = prev.filter(
        (existing) =>
          !(
            existing.listId === entry.listId &&
            Math.abs(existing.pin.lat - entry.pin.lat) < 1e-8 &&
            Math.abs(existing.pin.lng - entry.pin.lng) < 1e-8
          )
      )
      return [...next, entry]
    })
  }, [])

  const removeEntry = React.useCallback((listId: string, pin: SavedEntry["pin"]) => {
    setEntries((prev) =>
      prev.filter(
        (existing) =>
          !(
            existing.listId === listId &&
            Math.abs(existing.pin.lat - pin.lat) < 1e-8 &&
            Math.abs(existing.pin.lng - pin.lng) < 1e-8
          )
      )
    )
  }, [])

  const addList = React.useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error("List name must not be empty")
    }

    const definition: SavedListDefinition = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
    }

    setLists((prev) => [...prev, definition])
    return definition
  }, [])

  const removeList = React.useCallback((listId: string) => {
    setLists((prev) => prev.filter((list) => list.id !== listId))
    setEntries((prev) => prev.filter((entry) => entry.listId !== listId))
  }, [])

  const value = React.useMemo(
    () => ({ lists, entries, addEntry, removeEntry, addList, removeList }),
    [lists, entries, addEntry, removeEntry, addList, removeList]
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
