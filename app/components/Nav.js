'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import PlayerSearch from './PlayerSearch'

const links = [
  ['/signings', 'Signings'],
  ['/players', 'Players'],
  ['/markets', 'Markets'],
  ['/development', 'Development'],
  ['/asset-conversion', 'Asset Conversion'],
  ['/league', 'League Benchmark'],
  ['/research', 'Research & Coverage'],
  ['/methodology', 'Methodology'],
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <div className="site-nav-wrap">
      <nav className="site-nav shell" aria-label="DISI sections">
        <Link className="nav-brand" href="/" aria-label="DISI home">
          <span className="brand-mark">DISI</span>
          <span className="brand-name">Dodgers International Signings Research Database</span>
        </Link>
        <PlayerSearch />
      </nav>
      <div className="nav-links shell">
        {links.map(([href, label]) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return <Link key={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} href={href}>{label}</Link>
        })}
      </div>
    </div>
  )
}
