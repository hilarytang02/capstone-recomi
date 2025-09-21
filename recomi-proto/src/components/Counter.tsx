'use client'

import { useAppStore } from '@/lib/store'
import { Card } from './Card'

export function Counter() {
  const { count, increment, decrement, reset } = useAppStore()

  return (
    <Card className="max-w-md mx-auto">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Counter Demo</h2>
        <div className="text-4xl font-bold text-gray-700 mb-6">{count}</div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={decrement}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            -
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            Reset
          </button>
          <button
            onClick={increment}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            +
          </button>
        </div>
      </div>
    </Card>
  )
}
