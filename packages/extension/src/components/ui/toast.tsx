import { useEffect } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'

const icons = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
}

const styles = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
}

const iconStyles = {
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-500',
}

export function Toast() {
  const { toast, hideToast } = useUIStore()

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(hideToast, 5000)
      return () => clearTimeout(timer)
    }
  }, [toast, hideToast])

  if (!toast) return null

  const Icon = icons[toast.type]

  return (
    <div
      className={cn(
        'fixed bottom-20 left-4 right-4 flex items-center gap-3 p-3 rounded-xl border shadow-lg',
        'animate-in slide-in-from-bottom-4 duration-300',
        styles[toast.type]
      )}
      role="alert"
    >
      <Icon className={cn('w-5 h-5 flex-shrink-0', iconStyles[toast.type])} />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={hideToast}
        className="p-1 hover:bg-black/5 rounded-lg transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
