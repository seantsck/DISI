export default function DataUnavailable({ error, message='This page only displays records returned by Supabase. No fallback or mock data is used.' }) {
  return (
    <section className="shell data-unavailable">
      <span className="eyebrow">Data unavailable</span>
      <h2>No substitute dataset loaded.</h2>
      <p>{message}</p>
      {error && <code>{error}</code>}
    </section>
  )
}
