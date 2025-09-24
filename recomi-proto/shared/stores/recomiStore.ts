import { create } from 'zustand'
import { User, Place, Recommendation, UserProfile } from '../types'

interface RecomiState {
  // User state
  currentUser: User | null
  userProfile: UserProfile | null
  
  // Places and recommendations
  places: Place[]
  recommendations: Recommendation[]
  wishlist: Recommendation[]
  favorites: Recommendation[]
  
  // Social features
  following: string[]
  followers: string[]
  
  // UI state
  selectedPlace: Place | null
  isAdventureMode: boolean
  
  // Actions
  setCurrentUser: (user: User) => void
  addToWishlist: (place: Place, notes?: string) => void
  addToFavorites: (place: Place, notes?: string) => void
  removeFromWishlist: (placeId: string) => void
  removeFromFavorites: (placeId: string) => void
  toggleAdventureMode: () => void
  followUser: (userId: string) => void
  unfollowUser: (userId: string) => void
  setSelectedPlace: (place: Place | null) => void
}

export const useRecomiStore = create<RecomiState>((set, get) => ({
  // Initial state
  currentUser: null,
  userProfile: null,
  places: [],
  recommendations: [],
  wishlist: [],
  favorites: [],
  following: [],
  followers: [],
  selectedPlace: null,
  isAdventureMode: false,
  
  // Actions
  setCurrentUser: (user) => set({ currentUser: user }),
  
  addToWishlist: (place, notes) => {
    const recommendation: Recommendation = {
      id: `wishlist-${Date.now()}`,
      userId: get().currentUser?.id || '',
      placeId: place.id,
      place,
      type: 'wishlist',
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes,
    }
    
    set((state) => ({
      wishlist: [...state.wishlist, recommendation],
      recommendations: [...state.recommendations, recommendation],
    }))
  },
  
  addToFavorites: (place, notes) => {
    const recommendation: Recommendation = {
      id: `favorite-${Date.now()}`,
      userId: get().currentUser?.id || '',
      placeId: place.id,
      place,
      type: 'favorite',
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes,
    }
    
    set((state) => ({
      favorites: [...state.favorites, recommendation],
      recommendations: [...state.recommendations, recommendation],
    }))
  },
  
  removeFromWishlist: (placeId) => {
    set((state) => ({
      wishlist: state.wishlist.filter(rec => rec.placeId !== placeId),
      recommendations: state.recommendations.filter(rec => 
        !(rec.placeId === placeId && rec.type === 'wishlist')
      ),
    }))
  },
  
  removeFromFavorites: (placeId) => {
    set((state) => ({
      favorites: state.favorites.filter(rec => rec.placeId !== placeId),
      recommendations: state.recommendations.filter(rec => 
        !(rec.placeId === placeId && rec.type === 'favorite')
      ),
    }))
  },
  
  toggleAdventureMode: () => set((state) => ({ isAdventureMode: !state.isAdventureMode })),
  
  followUser: (userId) => {
    set((state) => ({
      following: [...state.following, userId],
    }))
  },
  
  unfollowUser: (userId) => {
    set((state) => ({
      following: state.following.filter(id => id !== userId),
    }))
  },
  
  setSelectedPlace: (place) => set({ selectedPlace: place }),
}))
