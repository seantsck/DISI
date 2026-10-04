import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="shell footer">
      <div className="footer-brand">
        <strong>DISI v0.2</strong>
        <span>Public-data baseball operations portfolio prototype</span>
      </div>
      <div className="footer-links">
        <Link href="/methodology">Methodology &amp; data provenance</Link>
        <span>Descriptive findings · tracked sample · public sources</span>
      </div>
    </footer>
  )
}
