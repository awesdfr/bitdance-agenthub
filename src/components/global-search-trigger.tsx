'use client'

import { Search } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { useSearchStore } from '@/stores/search-store'

export function GlobalSearchTrigger() {
  const openSearch = useSearchStore((s) => s.openSearch)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K on Mac, Ctrl+K on other platforms
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch])

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={openSearch}
      className="gap-2"
      aria-label="Search messages"
    >
      <Search className="h-4 w-4" />
      <span className="hidden md:inline">Search</span>
      <kbd className="ml-2 hidden rounded border bg-muted px-1 text-xs md:inline">⌘K</kbd>
    </Button>
  )
}