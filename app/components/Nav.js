'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  ['/', 'Overview'],
  ['/signings', 'Signings'],
  ['/markets', 'Markets'],
  ['/league', 'League Benchmark'],
  ['/development', 'Development'],
  ['/asset-conversion', 'Asset Conversion'],
  ['/methodology', 'Methodology']
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <div className="site-nav-wrap">
      <nav className="site-nav shell" aria-label="DISI sections">
        <Link className="nav-brand" href="/">
          <span className="brand-mark">DISI</span>
          <span className="brand-name">Dodgers International Signing Intelligence</span>
        </Link>
        <div className="nav-links">
          {links.map(([href, label]) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
            return <Link key={href} className={active ? 'active' : ''} href={href}>{label}</Link>
          })}
        </div>
      </nav>
    </div>
  )
}
