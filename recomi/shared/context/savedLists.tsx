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

export const LIST_DEFINITIONS: SavedListDefinition[] = [
  { id: "1", name: "Weekend Brunch Spots" },
  { id: "2", name: "Coffee Crawl" },
  { id: "3", name: "Date Night Ideas" },
  { id: "4", name: "Bucket List Cities" },
  { id: "5", name: "Friend Recs" },
  { id: "6", name: "Hidden Gems" },
]

type SavedListsContextValue = {
  entries: SavedEntry[]
  addEntry: (entry: SavedEntry) => void
}

const SavedListsContext = React.createContext<SavedListsContextValue | undefined>(undefined)

export function SavedListsProvider({ children }: { children: React.ReactNode }) {
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

  const value = React.useMemo(() => ({ entries, addEntry }), [entries, addEntry])

  return <SavedListsContext.Provider value={value}>{children}</SavedListsContext.Provider>
}

export function useSavedLists() {
  const context = React.useContext(SavedListsContext)
  if (!context) {
    throw new Error("useSavedLists must be used within a SavedListsProvider")
  }
  return context
}
