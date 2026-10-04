'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/**
 * URL-backed filter form. It is a real GET form, so it works without
 * JavaScript; with JavaScript, changes apply immediately (search is debounced)
 * and the URL is replaced so the current research view stays shareable.
 *
 * fields: [{ name, label, type: 'search'|'select', placeholder?, options?: [{ value, label }] }]
 * values: current (validated) values from the server
 * defaults: values omitted from the URL (e.g. the default scope)
 * hidden: parameters to carry over unchanged (sort, dir)
 */
export default function FilterForm({ pathname, fields, values, defaults = {}, hidden = {}, resetHref }) {
  const router = useRouter()
  const formRef = useRef(null)
  const lastSubmitted = useRef(null)
  const [pending, startTransition] = useTransition()
  const searchField = fields.find((f) => f.type === 'search')
  const serverQuery = (searchField && values[searchField.name]) || ''
  const [text, setText] = useState(serverQuery)
  const [syncedQuery, setSyncedQuery] = useState(serverQuery)

  // Adopt the server's value when it changes from outside this input
  // (e.g. "Clear filters"), without clobbering what the user is typing.
  if (serverQuery !== syncedQuery) {
    setSyncedQuery(serverQuery)
    if (serverQuery !== text.trim()) setText(serverQuery)
  }

  function navigate() {
    if (!formRef.current) return
    lastSubmitted.current = text.trim()
    const params = new URLSearchParams()
    for (const [key, raw] of new FormData(formRef.current)) {
      const value = String(raw).trim()
      if (value && defaults[key] !== value) params.set(key, value)
    }
    const qs = params.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  useEffect(() => {
    const typed = text.trim()
    // Skip when the URL already reflects the input, or when this exact input
    // was already submitted (the server may normalise it away, e.g. "%").
    if (typed === serverQuery || typed === lastSubmitted.current) return undefined
    const timer = setTimeout(navigate, 350)
    return () => clearTimeout(timer)
    // navigate reads the live form; re-running on every render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, serverQuery])

  return (
    <form
      ref={formRef}
      action={pathname}
      method="get"
      role="search"
      className={`filter-form${pending ? ' is-pending' : ''}`}
      onSubmit={(event) => { event.preventDefault(); navigate() }}
    >
      {Object.entries(hidden).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
      {fields.map((field) => field.type === 'search' ? (
        <label key={field.name} className="filter-field filter-search">
          <span>{field.label}</span>
          <input
            type="search"
            name={field.name}
            value={text}
            placeholder={field.placeholder}
            autoComplete="off"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      ) : (
        <label key={field.name} className="filter-field">
          <span>{field.label}</span>
          <select
            key={values[field.name] ?? ''}
            name={field.name}
            defaultValue={values[field.name] ?? defaults[field.name] ?? ''}
            onChange={navigate}
          >
            {!(field.name in defaults) && <option value="">All</option>}
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      ))}
      <div className="filter-actions">
        <noscript><button type="submit" className="button-link">Apply</button></noscript>
        {resetHref && <Link className="text-link" href={resetHref} scroll={false}>Clear filters</Link>}
        <span className="filter-status" aria-live="polite">{pending ? 'Updating…' : ''}</span>
      </div>
    </form>
  )
}
