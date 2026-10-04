export default function DataMode({ live, error }) {
  const label = live ? 'Live Supabase data' : 'Live data unavailable'
  return <span className={`data-badge ${live ? 'live' : 'offline'}`} title={error || undefined}>{label}</span>
}
