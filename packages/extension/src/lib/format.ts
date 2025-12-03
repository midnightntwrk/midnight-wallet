const DECIMALS = 8
const TOKEN_SYMBOL = 'tDUST'

export function formatAmount(value: string | bigint, decimals = DECIMALS): string {
  const amount = typeof value === 'string' ? BigInt(value) : value
  const divisor = BigInt(10 ** decimals)
  const integerPart = amount / divisor
  const fractionalPart = amount % divisor

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  const trimmedFractional = fractionalStr.replace(/0+$/, '')

  if (trimmedFractional === '') {
    return integerPart.toString()
  }

  return `${integerPart}.${trimmedFractional}`
}

const MAX_SAFE_AMOUNT = BigInt('9999999999999999999999')

export function parseAmount(value: string, decimals = DECIMALS): bigint {
  const sanitized = value.replace(/[^0-9.]/g, '')
  if (!sanitized || sanitized === '.') {
    return BigInt(0)
  }

  const [integerPart = '0', fractionalPart = ''] = sanitized.split('.')

  if (integerPart.length > 20) {
    throw new Error('Amount too large')
  }

  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals)
  const result = BigInt((integerPart || '0') + paddedFractional)

  if (result > MAX_SAFE_AMOUNT) {
    throw new Error('Amount exceeds maximum allowed value')
  }

  return result
}

export function formatAmountWithSymbol(value: string | bigint, symbol = TOKEN_SYMBOL): string {
  return `${formatAmount(value)} ${symbol}`
}

export function truncateAddress(address: string, startChars = 10, endChars = 6): string {
  if (address.length <= startChars + endChars + 3) {
    return address
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return days === 1 ? '1 day ago' : `${days} days ago`
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  }
  return 'Just now'
}

export function isValidMidnightAddress(address: string): boolean {
  return address.startsWith('mn_dust_') && address.length >= 40 && address.length <= 120
}
