import { useSettingsStore } from '@/store/settings-store'

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

interface BlockResponse {
  block: {
    height: number
    timestamp: number
    hash: string
  } | null
}

interface DustGenerationStatusResponse {
  dustGenerationStatus: {
    dustAddress: string | null
    currentCapacity: string
    generationRate: string
    nightBalance: string
    registered: boolean
  } | null
}

async function queryIndexer<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const settings = useSettingsStore.getState()
  const config = settings.getNetworkConfig()

  const response = await fetch(config.indexerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Indexer request failed: ${response.status}`)
  }

  const result: GraphQLResponse<T> = await response.json()

  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0].message)
  }

  if (!result.data) {
    throw new Error('No data in response')
  }

  return result.data
}

export async function getLatestBlock(): Promise<{ height: number; timestamp: number; hash: string } | null> {
  const query = `
    query LatestBlock {
      block {
        height
        timestamp
        hash
      }
    }
  `

  const data = await queryIndexer<BlockResponse>(query)
  return data.block
}

export async function getDustGenerationStatus(
  cardanoStakeKey: string
): Promise<DustGenerationStatusResponse['dustGenerationStatus']> {
  const query = `
    query DustStatus($key: HexEncoded!) {
      dustGenerationStatus(cardanoStakeKey: $key) {
        dustAddress
        currentCapacity
        generationRate
        nightBalance
        registered
      }
    }
  `

  const data = await queryIndexer<DustGenerationStatusResponse>(query, { key: cardanoStakeKey })
  return data.dustGenerationStatus
}

export async function checkIndexerConnection(): Promise<boolean> {
  try {
    const block = await getLatestBlock()
    return block !== null
  } catch {
    return false
  }
}
