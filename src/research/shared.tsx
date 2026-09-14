import { useEffect, useState, type ReactNode } from 'react'
import { Download, ArrowUpRight, RefreshCw } from 'lucide-react'
import { assetUrl } from '../lib/assetUrl'

export function useJson<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    fetch(assetUrl(path), { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error(`Data unavailable (${response.status})`)
      return response.json()
    }).then(setData).catch(cause => { if (!abort.signal.aborted) setError(String(cause)) })
    return () => abort.abort()
  }, [path, attempt])
  return { data, error, retry: () => setAttempt(value => value + 1) }
}

export function DataState({ error, retry }: { error: string; retry: () => void }) {
  return <div className="data-state" role="status">{error ? <><p>{error}</p><button onClick={retry}><RefreshCw size={16} />Retry</button></> : 'Loading experiment data...'}</div>
}

export function Tabs({ label, options, value, onChange }: {
  label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void
}) {
  return <div className="research-tabs" role="tablist" aria-label={label}>{options.map((option, index) =>
    <button key={option.value} type="button" role="tab" aria-selected={value === option.value}
      tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)} onKeyDown={event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length
        onChange(options[next].value)
        const buttons = event.currentTarget.parentElement?.querySelectorAll('button')
        buttons?.[next].focus()
      }}>{option.label}</button>)}</div>
}

export function SectionHeading({ number, eyebrow, title, children }: { number: string; eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="section-heading"><div className="section-index">{number}</div><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children && <div className="section-deck">{children}</div>}</div></header>
}

export function FigureLinks({ data, figure }: { data: string; figure?: string }) {
  return <div className="figure-links"><a href={assetUrl(data)} target="_blank" rel="noreferrer"><Download size={14} />Data</a>{figure && <a href={assetUrl(figure)} target="_blank" rel="noreferrer"><ArrowUpRight size={14} />Full figure</a>}</div>
}

export function Finding({ children, caveat }: { children: ReactNode; caveat?: ReactNode }) {
  return <div className="finding"><p>{children}</p>{caveat && <p className="finding-caveat">{caveat}</p>}</div>
}
