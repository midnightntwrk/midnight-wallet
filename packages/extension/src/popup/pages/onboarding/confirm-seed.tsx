import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WordChallenge {
  index: number
  correctWord: string
  options: string[]
  selectedWord: string | null
}

export function ConfirmSeedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mnemonic, isNewWallet } = (location.state as {
    mnemonic: string[]
    isNewWallet: boolean
  }) || { mnemonic: [], isNewWallet: true }

  const [challenges, setChallenges] = useState<WordChallenge[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!mnemonic || mnemonic.length === 0) {
      navigate('/welcome', { replace: true })
      return
    }

    const indices = generateRandomIndices(mnemonic.length, 3)
    const newChallenges = indices.map((index) => ({
      index,
      correctWord: mnemonic[index],
      options: generateOptions(mnemonic[index], mnemonic),
      selectedWord: null,
    }))
    setChallenges(newChallenges)
  }, [mnemonic, navigate])

  const allCorrect = useMemo(() => {
    return (
      challenges.length > 0 &&
      challenges.every((c) => c.selectedWord === c.correctWord)
    )
  }, [challenges])

  const allSelected = useMemo(() => {
    return challenges.every((c) => c.selectedWord !== null)
  }, [challenges])

  const handleSelectWord = (challengeIndex: number, word: string) => {
    setChallenges((prev) =>
      prev.map((c, i) =>
        i === challengeIndex ? { ...c, selectedWord: word } : c
      )
    )
    setError('')
  }

  const handleContinue = () => {
    if (!allSelected) {
      setError('Please select all words')
      return
    }

    if (!allCorrect) {
      setError('Some words are incorrect. Please try again.')
      return
    }

    navigate('/set-password', { state: { mnemonic, isNewWallet } })
  }

  if (!mnemonic || mnemonic.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-4 py-3 border-b border-slate-100">
        <button
          onClick={() => navigate('/backup-seed', { state: { mnemonic, isNewWallet } })}
          className="p-2 -ml-2 hover:bg-slate-100 rounded-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold text-center mr-7">
          Verify Recovery Phrase
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-semibold">
              3
            </span>
            <span className="text-sm font-medium text-indigo-600">of 3</span>
          </div>
          <h2 className="text-center text-lg font-semibold mb-1">
            Confirm Your Backup
          </h2>
          <p className="text-center text-sm text-slate-500">
            Select the correct word for each position
          </p>
        </div>

        <div className="space-y-6">
          {challenges.map((challenge, challengeIndex) => (
            <div key={challengeIndex} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  Word #{challenge.index + 1}
                </span>
                {challenge.selectedWord && (
                  challenge.selectedWord === challenge.correctWord ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {challenge.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => handleSelectWord(challengeIndex, option)}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      challenge.selectedWord === option
                        ? option === challenge.correctWord
                          ? 'bg-green-50 border-green-500 text-green-700'
                          : 'bg-red-50 border-red-500 text-red-700'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-red-500 text-sm mt-4 text-center">{error}</p>
        )}
      </main>

      <div className="p-4 border-t border-slate-100">
        <Button
          onClick={handleContinue}
          disabled={!allSelected}
          className="w-full"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

function generateRandomIndices(length: number, count: number): number[] {
  const indices: number[] = []
  while (indices.length < count) {
    const index = Math.floor(Math.random() * length)
    if (!indices.includes(index)) {
      indices.push(index)
    }
  }
  return indices.sort((a, b) => a - b)
}

function generateOptions(correct: string, allWords: string[]): string[] {
  const options = new Set<string>([correct])
  const otherWords = allWords.filter((w) => w !== correct)

  while (options.size < 4 && otherWords.length > 0) {
    const randomIndex = Math.floor(Math.random() * otherWords.length)
    options.add(otherWords[randomIndex])
  }

  return Array.from(options).sort(() => Math.random() - 0.5)
}
