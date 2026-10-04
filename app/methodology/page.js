import Link from 'next/link'

export const metadata = { title:'Methodology — DISI' }

const principles = [
  ['Tracked sample ≠ organization-wide rate', 'The current mature analysis contains 17 audited tracked signings. It is not a complete census of every Dodgers international signing in the period.'],
  ['Missing ≠ zero', 'Unknown bonuses, outcomes, dates, milestones, and performance fields remain NULL until supported by evidence.'],
  ['Pathways stay separate', 'Teenage Latin American amateurs, Cuban professional experience, and posted NPB players are not treated as interchangeable acquisition populations.'],
  ['Identification ≠ realization', 'A player can validate scouting while producing his MLB value elsewhere. DISI separates talent identification, development, disposition, and return.'],
  ['Trade packages use shared attribution', 'The full return from a multi-player trade is never assigned to one international signee merely because that player appears in the package.'],
  ['Context remains visible', 'Standings, roster need, acquisition horizon, postseason outcome, source confidence, and analyst interpretation remain inspectable rather than hidden inside a black-box score.']
]

export default function MethodologyPage() {
  return <main className="shell page-main methodology-page">
    <header className="page-hero"><div><span className="eyebrow">Research design</span><h1>Methodology &amp; Data Provenance</h1><p>DISI is designed to make uncertainty inspectable. The point is not to manufacture certainty from public data; it is to structure what can be known, what remains unknown, and what questions deserve deeper baseball-operations work.</p></div></header>
    <section className="principle-grid">{principles.map(([title,body],i) => <article className="principle-card" key={title}><span>0{i+1}</span><h2>{title}</h2><p>{body}</p></article>)}</section>
    <section className="method-stack">
      <article><span className="eyebrow">Database lineage</span><h2>Thirteen canonical analytical layers</h2><p>The repository preserves the SQL sequence from core schema and seed cohort through outcome auditing, capital-efficiency analysis, package-aware trade valuation, competitive context, and the executive dashboard feed.</p><code>database/sql/001 … 013</code></article>
      <article><span className="eyebrow">Repair history</span><h2>Troubleshooting is preserved, not disguised</h2><p>The initial manual Supabase build required three diagnostic/repair scripts. They remain in a separate historical folder rather than being represented as part of the clean canonical build.</p><code>database/repairs/004a … 004c</code></article>
      <article><span className="eyebrow">Next research expansion</span><h2>What would make the analysis stronger</h2><p>Continue the historical signing census, audit outcomes for newly added historical rows, expand annual league-wide signing classes, trainer/academy networks, translated league performance, comparable-player models, and signing-pool optimization.</p><Link className="button-link" href="/signings">Inspect the tracked cohort →</Link></article>
    </section>
  </main>
}
