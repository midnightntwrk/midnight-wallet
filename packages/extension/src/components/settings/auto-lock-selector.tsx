import { ChevronDown, Clock } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useSettingsStore, AUTO_LOCK_OPTIONS } from '@/store/settings-store'

export function AutoLockSelector() {
  const { autoLockMinutes, setAutoLock } = useSettingsStore()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentOption = AUTO_LOCK_OPTIONS.find(o => o.value === autoLockMinutes) || AUTO_LOCK_OPTIONS[1]

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center justify-between p-3 rounded-xl border border-slate-200',
          'hover:bg-slate-50 transition-colors'
        )}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-slate-900">{currentOption.label}</p>
            <p className="text-xs text-slate-500">Auto-lock timeout</p>
          </div>
        </div>
        <ChevronDown className={cn('w-5 h-5 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
          {AUTO_LOCK_OPTIONS.map((option) => {
            const isSelected = autoLockMinutes === option.value
            return (
              <button
                key={option.value}
                onClick={() => {
                  setAutoLock(option.value)
                  setIsOpen(false)
                }}
                className={cn(
                  'w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors',
                  isSelected && 'bg-indigo-50'
                )}
              >
                <span className={cn('text-sm', isSelected ? 'text-indigo-600 font-medium' : 'text-slate-700')}>
                  {option.label}
                </span>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
