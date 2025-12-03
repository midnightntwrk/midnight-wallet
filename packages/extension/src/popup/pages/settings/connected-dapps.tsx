import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Link2Off, Globe, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/store/ui-store'
import { sendMessage } from '@/lib/background'

interface ConnectedDapp {
  origin: string
  hostname: string
}

export function ConnectedDappsPage() {
  const navigate = useNavigate()
  const { showToast } = useUIStore()
  const [dapps, setDapps] = useState<ConnectedDapp[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    loadConnectedDapps()
  }, [])

  async function loadConnectedDapps() {
    try {
      const origins = await sendMessage<string[]>('GET_CONNECTED_DAPPS')
      const mapped = origins.map((origin) => ({
        origin,
        hostname: getHostname(origin),
      }))
      setDapps(mapped)
    } catch (err) {
      showToast('Failed to load connected dApps', 'error')
    } finally {
      setLoading(false)
    }
  }

  function getHostname(origin: string): string {
    try {
      return new URL(origin).hostname
    } catch {
      return origin
    }
  }

  async function handleRevoke(origin: string) {
    setRevoking(origin)
    try {
      await sendMessage('REVOKE_DAPP', { origin })
      setDapps((prev) => prev.filter((d) => d.origin !== origin))
      showToast('Connection revoked', 'success')
    } catch (err) {
      showToast('Failed to revoke connection', 'error')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-slate-100">
        <button
          onClick={() => navigate('/settings')}
          className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">Connected dApps</h1>
      </div>

      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : dapps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Globe className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="font-medium text-slate-900 mb-1">No connected dApps</h3>
            <p className="text-sm text-slate-500 max-w-[200px]">
              Connect to dApps to see them here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {dapps.map((dapp) => (
              <div
                key={dapp.origin}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{dapp.hostname}</p>
                    <p className="text-xs text-slate-500 truncate max-w-[150px]">{dapp.origin}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(dapp.origin)}
                  disabled={revoking === dapp.origin}
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                >
                  {revoking === dapp.origin ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Link2Off className="w-4 h-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
