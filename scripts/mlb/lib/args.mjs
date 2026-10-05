// Tiny `--key value` / `--flag` argument parser for the research commands.

export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const [key, inline] = a.slice(2).split('=', 2)
    if (inline !== undefined) out[key] = inline
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i]
    else out[key] = true
  }
  return out
}

export function requireArg(args, name, hint) {
  if (args[name] === undefined || args[name] === true) {
    throw new Error(`Missing --${name}${hint ? ` (${hint})` : ''}`)
  }
  return args[name]
}
