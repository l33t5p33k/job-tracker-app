#!/usr/bin/env node
/**
 * Read-only health check against the live Supabase project.
 *
 *   node scripts/audit.mjs
 *
 * Answers the questions you can't answer by looking at the UI:
 *   - is the project awake and are the credentials good?
 *   - is any tracked time stranded in entries that never got closed?
 *   - are there jobs hidden by a NULL `archived` value?
 *   - does what the DB holds for today/this week match what the app shows?
 *
 * Writes nothing. Safe to run any time, including against production.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const SHOP_TZ = 'America/Los_Angeles'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  let raw
  try {
    raw = readFileSync(resolve(root, '.env.local'), 'utf8')
  } catch {
    console.error('No .env.local found. Copy .env.example and fill it in.')
    process.exit(1)
  }
  const env = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

// Mirrors src/time.ts. Duplicated on purpose: if this script and the app ever
// disagree about when "today" starts, that's exactly the bug worth catching.
function shopParts(d) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(d)
  const v = t => Number(f.find(p => p.type === t).value)
  return { y: v('year'), m: v('month'), d: v('day'), h: v('hour') % 24, mi: v('minute'), s: v('second') }
}

function shopMidnight(y, m, d) {
  const naive = Date.UTC(y, m - 1, d)
  const offset = i => {
    const p = shopParts(new Date(i))
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(i / 1000) * 1000
  }
  let t = naive - offset(naive)
  return new Date(naive - offset(t))
}

function dayStart(now = new Date()) {
  const p = shopParts(now)
  return shopMidnight(p.y, p.m, p.d)
}

function weekStart(now = new Date()) {
  const p = shopParts(now)
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - ((weekday + 6) % 7)))
  return shopMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
}

const hrs = s => `${(s / 3600).toFixed(2)}h`
const inShopTz = d => new Date(d).toLocaleString('en-US', { timeZone: SHOP_TZ })

let problems = 0
const ok = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const warn = m => { problems++; console.log(`  \x1b[33m!\x1b[0m ${m}`) }
const bad = m => { problems++; console.log(`  \x1b[31m✗\x1b[0m ${m}`) }

const env = loadEnv()
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

console.log(`\nShop Timer audit — ${inShopTz(new Date())} Pacific\n`)

// 1. Connectivity. A paused free-tier project fails here, and only here.
console.log('Connectivity')
const started = Date.now()
const { error: pingErr } = await supabase.from('jobs').select('id').limit(1)
if (pingErr) {
  bad(`cannot reach the database: ${pingErr.message}`)
  console.log('\n    If the project is paused, restore it from the Supabase dashboard.')
  console.log('    A pause freezes your data, it does not delete it.\n')
  process.exit(1)
}
ok(`reachable in ${Date.now() - started}ms`)

// 2. Auth. Anonymous reads returning rows means RLS is not protecting anything.
console.log('\nRow-level security')
const { data: anonRows } = await supabase.from('time_entries').select('id').limit(1)
if (anonRows?.length) warn('unauthenticated reads return rows — check RLS policies on time_entries')
else ok('unauthenticated reads are blocked (or there is no data yet)')

// 3. Jobs, including any hidden by a NULL archived flag.
console.log('\nJobs')
const { data: allJobs, error: jobsErr } = await supabase.from('jobs').select('*')
if (jobsErr) {
  bad(`could not read jobs: ${jobsErr.message}`)
} else {
  const visible = allJobs.filter(j => j.archived !== true)
  const nullArchived = allJobs.filter(j => j.archived === null || j.archived === undefined)
  const general = allJobs.filter(j => j.is_general)

  ok(`${allJobs.length} total, ${visible.length} visible, ${allJobs.length - visible.length} archived`)
  if (nullArchived.length) {
    warn(`${nullArchived.length} job(s) have archived = NULL — the old .eq('archived', false) query hid these`)
  }
  if (general.length === 0) warn("no job is flagged is_general — unallocated time has nowhere to go")
  if (general.length > 1) warn(`${general.length} jobs are flagged is_general — there should be exactly one`)
}

// 4. Stranded time. This is where hours actually go missing.
console.log('\nUnclosed time entries')
const { data: open, error: openErr } = await supabase
  .from('time_entries').select('*').is('ended_at', null)

if (openErr) {
  bad(`could not read time_entries: ${openErr.message}`)
} else if (!open.length) {
  ok('none')
} else {
  const sessionIds = [...new Set(open.map(e => e.session_id).filter(Boolean))]
  const { data: parents } = sessionIds.length
    ? await supabase.from('sessions').select('id, clocked_out_at').in('id', sessionIds)
    : { data: [] }
  const closed = new Map((parents ?? []).filter(s => s.clocked_out_at).map(s => [s.id, s.clocked_out_at]))

  let recoverable = 0
  let stranded = 0
  let strandedSeconds = 0

  for (const e of open) {
    const end = closed.get(e.session_id)
    if (end) {
      recoverable++
    } else {
      stranded++
      strandedSeconds += Math.max(0, (Date.now() - new Date(e.started_at).getTime()) / 1000)
    }
  }

  if (recoverable) {
    ok(`${recoverable} will be closed automatically on next load (parent session has a clock-out)`)
  }
  if (stranded) {
    warn(`${stranded} entry(s) belong to a session that never clocked out — up to ${hrs(strandedSeconds)} uncounted`)
    for (const e of open.filter(e => !closed.has(e.session_id)).slice(0, 5)) {
      console.log(`      started ${inShopTz(e.started_at)} (job ${e.job_id})`)
    }
  }
}

// 5. Sessions left open.
console.log('\nOpen sessions')
const { data: openSessions } = await supabase
  .from('sessions').select('*').is('clocked_out_at', null).order('clocked_in_at', { ascending: false })

if (!openSessions?.length) {
  ok('none — nobody is clocked in')
} else if (openSessions.length === 1) {
  ok(`1, clocked in ${inShopTz(openSessions[0].clocked_in_at)}`)
} else {
  warn(`${openSessions.length} sessions are open at once — only the newest is used, the rest strand their entries`)
  for (const s of openSessions.slice(1, 6)) console.log(`      stale: ${inShopTz(s.clocked_in_at)}`)
}

// 6. What the app should be showing right now.
console.log('\nTotals the app should display')
const ws = weekStart()
const ds = dayStart()
console.log(`  week starts ${inShopTz(ws)} Pacific`)
console.log(`  today starts ${inShopTz(ds)} Pacific`)

const { data: weekEntries } = await supabase
  .from('time_entries').select('*').gte('started_at', ws.toISOString())

const todaySec = (weekEntries ?? [])
  .filter(e => new Date(e.started_at) >= ds)
  .reduce((n, e) => n + (e.duration_seconds ?? 0), 0)
const weekSec = (weekEntries ?? []).reduce((n, e) => n + (e.duration_seconds ?? 0), 0)

ok(`today ${hrs(todaySec)}, this week ${hrs(weekSec)} across ${weekEntries?.length ?? 0} entries`)
console.log('  → open the app and confirm the Today and This Week tabs match these numbers.')

console.log(
  problems === 0
    ? '\n\x1b[32mNo problems found.\x1b[0m\n'
    : `\n\x1b[33m${problems} thing(s) to look at.\x1b[0m\n`
)
