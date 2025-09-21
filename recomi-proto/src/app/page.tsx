import { Counter } from '@/components/Counter'
import { Card } from '@/components/Card'

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Recomi Proto
          </h1>
          <p className="text-lg text-gray-600">
            A clean, minimal Next.js 14 + TypeScript + Tailwind CSS project
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Features
            </h2>
            <ul className="space-y-2 text-gray-600">
              <li>• Next.js 14 with App Router</li>
              <li>• TypeScript</li>
              <li>• Tailwind CSS</li>
              <li>• Zustand state management</li>
              <li>• clsx for conditional classes</li>
              <li>• Absolute imports (@/components, @/lib)</li>
            </ul>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Design System
            </h2>
            <ul className="space-y-2 text-gray-600">
              <li>• System font stack</li>
              <li>• White/gray color palette</li>
              <li>• Rounded-2xl cards</li>
              <li>• Subtle shadows</li>
              <li>• Clean, minimal UI</li>
            </ul>
          </Card>
        </div>

        <Counter />
      </div>
    </div>
  )
}
