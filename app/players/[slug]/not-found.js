import Link from 'next/link'

export default function PlayerNotFound() {
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Player dossier</span>
          <h1>Player not found</h1>
          <p>No player in the database has this identifier. Player links use a canonical slug assigned when the player record is created.</p>
        </div>
      </header>
      <Link className="button-link" href="/players">Search the player directory →</Link>
    </main>
  )
}
