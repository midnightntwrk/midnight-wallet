import { useState, useRef, useCallback, useEffect } from 'react'
import { Input } from '@/components/ui/input'

interface SeedPhraseInputProps {
  wordCount?: 12 | 24
  onComplete: (words: string[]) => void
  onValidChange?: (isValid: boolean) => void
}

export function SeedPhraseInput({
  wordCount = 24,
  onComplete,
  onValidChange,
}: SeedPhraseInputProps) {
  const [words, setWords] = useState<string[]>(Array(wordCount).fill(''))
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const isAllFilled = useCallback(() => {
    return words.every((word) => word.trim().length > 0)
  }, [words])

  useEffect(() => {
    const valid = isAllFilled()
    onValidChange?.(valid)
    if (valid) {
      onComplete(words.map((w) => w.trim().toLowerCase()))
    }
  }, [words, isAllFilled, onComplete, onValidChange])

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words]
    newWords[index] = value.toLowerCase().trim()
    setWords(newWords)
  }

  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    const pastedText = e.clipboardData.getData('text')
    const pastedWords = pastedText.trim().split(/[\s,]+/).filter(Boolean)

    if (pastedWords.length > 1) {
      e.preventDefault()
      const newWords = [...words]
      for (let i = 0; i < pastedWords.length && index + i < wordCount; i++) {
        newWords[index + i] = pastedWords[i].toLowerCase()
      }
      setWords(newWords)

      const nextIndex = Math.min(index + pastedWords.length, wordCount - 1)
      inputRefs.current[nextIndex]?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === ' ' || e.key === 'Tab' || e.key === 'Enter') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
      }
      if (index < wordCount - 1) {
        inputRefs.current[index + 1]?.focus()
      }
    } else if (e.key === 'Backspace' && words[index] === '' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {words.map((word, index) => (
          <div key={index} className="flex items-center gap-1">
            <span className="text-xs text-slate-400 w-5 text-right flex-shrink-0">
              {index + 1}.
            </span>
            <Input
              ref={(el) => (inputRefs.current[index] = el)}
              value={word}
              onChange={(e) => handleWordChange(index, e.target.value)}
              onPaste={(e) => handlePaste(e, index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className="h-8 px-2 text-sm"
              placeholder=""
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500 text-center">
        Enter your {wordCount}-word recovery phrase. You can paste the entire phrase at once.
      </p>
    </div>
  )
}
