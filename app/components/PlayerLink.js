import Link from 'next/link'

/** Links a player name to its dossier; renders plain text when no slug exists. */
export default function PlayerLink({ slug, name, className = '' }) {
  if (!slug) return <span className={className}>{name}</span>
  return <Link className={`player-link ${className}`.trim()} href={`/players/${slug}`}>{name}</Link>
}
