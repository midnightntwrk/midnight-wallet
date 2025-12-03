import { cn } from '@/lib/utils'

interface SettingsSectionProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function SettingsSection({ title, children, className }: SettingsSectionProps) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider px-1">
        {title}
      </h3>
      <div className="space-y-1">
        {children}
      </div>
    </section>
  )
}
