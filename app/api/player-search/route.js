import { NextResponse } from 'next/server'
import { searchPlayers } from '../../../lib/data.js'

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get('q') || '').slice(0, 80)
  const result = await searchPlayers(q)
  return NextResponse.json(result, {
    status: result.live ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
