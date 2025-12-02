import { useEffect, useRef } from 'react'

interface QRCodeProps {
  value: string
  size?: number
}

export function QRCode({ value, size = 200 }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const moduleCount = 25
    const moduleSize = size / moduleCount
    const padding = 2

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, size, size)

    ctx.fillStyle = '#000000'

    const drawFinderPattern = (x: number, y: number) => {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          if (
            i === 0 || i === 6 || j === 0 || j === 6 ||
            (i >= 2 && i <= 4 && j >= 2 && j <= 4)
          ) {
            ctx.fillRect(
              (x + i + padding) * moduleSize,
              (y + j + padding) * moduleSize,
              moduleSize,
              moduleSize
            )
          }
        }
      }
    }

    drawFinderPattern(0, 0)
    drawFinderPattern(moduleCount - 7 - padding * 2, 0)
    drawFinderPattern(0, moduleCount - 7 - padding * 2)

    let seed = 0
    for (let i = 0; i < value.length; i++) {
      seed += value.charCodeAt(i)
    }

    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    for (let i = padding; i < moduleCount - padding; i++) {
      for (let j = padding; j < moduleCount - padding; j++) {
        const isInFinderPattern =
          (i < 9 && j < 9) ||
          (i < 9 && j > moduleCount - 10) ||
          (i > moduleCount - 10 && j < 9)

        if (!isInFinderPattern && seededRandom() > 0.5) {
          ctx.fillRect(i * moduleSize, j * moduleSize, moduleSize, moduleSize)
        }
      }
    }
  }, [value, size])

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
