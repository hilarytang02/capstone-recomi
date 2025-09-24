// Core user types
export interface User {
  id: string
  username: string
  displayName: string
  avatar?: string
  preferences: UserPreferences
  createdAt: Date
}

export interface UserPreferences {
  dietaryRestrictions: string[]
  priceRange: 'budget' | 'moderate' | 'expensive'
  cuisineTypes: string[]
  adventureMode: boolean
}

// Place types
export interface Place {
  id: string
  name: string
  category: 'restaurant' | 'coworking' | 'experience'
  address: string
  coordinates: {
    lat: number
    lng: number
  }
  priceRange: 'budget' | 'moderate' | 'expensive'
  cuisineType?: string
  rating?: number
  images: string[]
  description: string
  tags: string[]
}

// Recommendation types
export interface Recommendation {
  id: string
  userId: string
  placeId: string
  place: Place
  type: 'wishlist' | 'favorite' | 'visited'
  isPublic: boolean
  createdAt: Date
  updatedAt: Date
  notes?: string
}

export interface RecommendationStats {
  saves: number
  visits: number
  shares: number
}

// Social features
export interface Follow {
  id: string
  followerId: string
  followingId: string
  createdAt: Date
}

export interface CollaborativeList {
  id: string
  name: string
  description: string
  ownerId: string
  members: string[]
  places: string[]
  isPublic: boolean
  createdAt: Date
}

// Algorithm types
export interface UserProfile {
  userId: string
  preferences: UserPreferences
  behaviorPatterns: {
    savedPlaces: string[]
    visitedPlaces: string[]
    cuisinePreferences: Record<string, number>
    pricePreferences: Record<string, number>
  }
  lastUpdated: Date
}

export interface RecommendationContext {
  userId: string
  groupIds?: string[]
  location?: {
    lat: number
    lng: number
    radius: number
  }
  timeOfDay?: 'morning' | 'afternoon' | 'evening'
  occasion?: 'casual' | 'business' | 'date' | 'family'
}
