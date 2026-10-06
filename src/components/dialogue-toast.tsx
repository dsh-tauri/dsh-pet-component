import type { Ref } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface DialogueToastProps {
  ref?: Ref<HTMLDivElement>
  onSubmit: (text: string) => void
  onClose: () => void
}

export function DialogueToast({ ref, onSubmit, onClose }: DialogueToastProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [value, setValue] = useState('')
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    if (typeof ref === 'function') {
      const cleanup = ref(node)
      if (cleanup !== undefined) {
        return () => {
          if (rootRef.current === node) {
            rootRef.current = null
          }
          cleanup()
        }
      }
      return
    }
    if (ref !== null && ref !== undefined)
      ref.current = node
    return () => {
      if (rootRef.current === node)
        rootRef.current = null
      if (ref !== null && ref !== undefined && ref.current === node)
        ref.current = null
    }
  }, [ref])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (rootRef.current !== null && target instanceof Node && !rootRef.current.contains(target))
        onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onClose()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [onClose])

  const submit = () => {
    const text = value.trim()
    if (text === '')
      return
    onClose()
    onSubmit(text)
  }

  return (
    <div ref={setRootRef} className="dsh-pet__dialogue" role="dialog" aria-label="对话输入">
      <textarea
        ref={inputRef}
        className="dsh-pet__dialogue-input"
        value={value}
        maxLength={2000}
        rows={1}
        placeholder="说点什么…"
        aria-label="输入对话内容"
        onChange={(event) => {
          setValue(event.target.value)
          event.currentTarget.style.height = 'auto'
          event.currentTarget.style.height = `${Math.min(Math.max(event.currentTarget.scrollHeight, 40), 140)}px`
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
    </div>
  )
}
