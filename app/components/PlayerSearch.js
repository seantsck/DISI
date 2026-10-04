'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Header player search (WAI-ARIA combobox). Queries /api/player-search, which
 * reads Supabase server-side with the publishable key. Enter on a result opens
 * the player dossier; Enter with no active result opens the filtered directory.
 */
export default function PlayerSearch() {
  const router = useRouter()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return undefined
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setStatus('loading')
      try {
        const response = await fetch(`/api/player-search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        const body = await response.json()
        if (!response.ok || !body.live) throw new Error(body.error || 'Search unavailable')
        setResults(body.results)
        setActive(-1)
        setStatus('ready')
      } catch (error) {
        if (error.name !== 'AbortError') {
          setResults([])
          setStatus('error')
        }
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const tooShort = query.trim().length < 2
  const visibleResults = tooShort ? [] : results
  const expanded = open && !tooShort

  function go(href) {
    setOpen(false)
    setQuery('')
    setResults([])
    router.push(href)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' && visibleResults.length) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % visibleResults.length)
    } else if (event.key === 'ArrowUp' && visibleResults.length) {
      event.preventDefault()
      setActive((i) => (i <= 0 ? visibleResults.length - 1 : i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active >= 0 && visibleResults[active]) go(`/players/${visibleResults[active].player_slug}`)
      else if (!tooShort) go(`/players?q=${encodeURIComponent(query.trim())}&org_scope=all`)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="player-search">
      <label className="sr-only" htmlFor={`${listId}-input`}>Search players</label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        placeholder="Search players…"
        autoComplete="off"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120) }}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul id={listId} role="listbox" className="player-search-results" onMouseDown={() => clearTimeout(blurTimer.current)}>
          {status === 'loading' && !visibleResults.length && <li className="player-search-note">Searching…</li>}
          {status === 'error' && <li className="player-search-note">Search is unavailable (database not reachable).</li>}
          {status === 'ready' && !visibleResults.length && <li className="player-search-note">No players match “{query.trim()}”.</li>}
          {visibleResults.map((r, i) => (
            <li
              key={r.player_slug}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(`/players/${r.player_slug}`)}
            >
              <strong>{r.full_name}</strong>
              <span>
                {[r.first_signing_year, r.primary_position, r.first_signing_market, (r.organizations || []).join('/')].filter(Boolean).join(' · ')}
              </span>
              {r.aliases?.length > 0 && <small>also {r.aliases.join(', ')}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
