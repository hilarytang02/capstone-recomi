import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'dark'
}

export function Card({ children, className, variant = 'default' }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl shadow-sm border p-6',
        variant === 'default'
          ? 'bg-white border-gray-100'
          : 'bg-gray-900 border-gray-800',
        className
      )}
    >
      {children}
    </div>
  )
}
