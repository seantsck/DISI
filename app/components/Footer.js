import Link from 'next/link'
import pkg from '../../package.json'

export default function Footer() {
  return (
    <footer className="shell footer">
      <div className="footer-brand">
        <strong>DISI v{pkg.version}</strong>
        <span>Dodgers International Signings Research Database · public sources only</span>
      </div>
      <div className="footer-links">
        <Link href="/methodology">Methodology &amp; provenance</Link>
        <Link href="/research">Data coverage</Link>
        <span>Missing values stay missing · bWAR = Baseball-Reference WAR</span>
      </div>
    </footer>
  )
}
