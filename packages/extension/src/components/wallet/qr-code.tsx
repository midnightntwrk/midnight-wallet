import { useEffect, useRef, useState } from 'react'
import QRCodeLib from 'qrcode'

interface QRCodeProps {
  value: string
  size?: number
}

export function QRCode({ value, size = 200 }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !value) return

    QRCodeLib.toCanvas(
      canvas,
      value,
      {
        width: size,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
      },
      (err) => {
        if (err) {
          setError('Failed to generate QR code')
          console.error('QR code generation error:', err)
        } else {
          setError(null)
        }
      }
    )
  }, [value, size])

  if (error) {
    return (
      <div
        className="bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 text-sm"
        style={{ width: size, height: size }}
      >
        {error}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="block"
      />
    </div>
  )
}
