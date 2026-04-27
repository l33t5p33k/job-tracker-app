import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import styles from './App.module.css'

interface Job {
  id: string
  name: string
  is_general: boolean
  created_at: string
  isRunning?: boolean
  startedAt?: number | null
  totalSeconds?: number
  weeklySeconds?: number
}

interface Session {
  id?: string
  clocked_in_at?: string
  clocked_out_at?: string | null
  total_seconds?: number
}

interface TimeEntry {
  id?: string
  job_id: string
  session_id?: string
  started_at: string
  ended_at?: string | null
  duration_seconds?: number
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.setDate(diff))
  return monday.toISOString().slice(0, 10)
}

function exportToCSV(jobs: Job[], sessionSeconds: number, tab: 'today' | 'week') {
  const rows = [
    ['Job Name', 'Total Time'],
    ...jobs.map(j => [
      j.name,
      formatTime(tab === 'today' ? (j.totalSeconds ?? 0) : (j.weeklySeconds ?? 0))
    ]),
    [],
    [tab === 'today' ? 'Total Session Time' : 'Total Week Time', formatTime(sessionSeconds)]
  ]
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `job-times-${tab}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function formatHoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function buildWeeklySummary(jobs: Job[]): string {
  const weekStart = getWeekStart()
  const date = new Date(weekStart)
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const lines = jobs
    .filter(j => (j.weeklySeconds ?? 0) > 0)
    .map(j => `${j.name.padEnd(20)} ${formatHoursMinutes(j.weeklySeconds ?? 0)}`)

  const total = jobs.reduce((sum, j) => sum + (j.weeklySeconds ?? 0), 0)

  return [
    `⚙️ Time Tracker — Week of ${formatted}`,
    '',
    ...lines,
    '',
    `Total: ${formatHoursMinutes(total)}`
  ].join('\n')
}

function shareViaEmail(jobs: Job[]) {
  const summary = buildWeeklySummary(jobs)
  const subject = encodeURIComponent(`Weekly Hours`)
  const body = encodeURIComponent(summary)
  window.open(`mailto:?subject=${subject}&body=${body}`)
}

function shareViaText(jobs: Job[]) {
  const summary = buildWeeklySummary(jobs)
  const body = encodeURIComponent(summary)
  window.open(`sms:?&body=${body}`)
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'today' | 'week'>('today')
  const [, setTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionSecondsRef = useRef(0)
  const sessionStartRef = useRef<number | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => setTick(t => t + 1), 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)

    const { data: jobsData } = await supabase
      .from('jobs')
      .select('*')
      .order('is_general', { ascending: false })
      .order('created_at', { ascending: true })

    // Today's entries
    const today = new Date().toISOString().slice(0, 10)
    const { data: todayEntries } = await supabase
      .from('time_entries')
      .select('*')
      .gte('started_at', `${today}T00:00:00`)

    // This week's entries
    const weekStart = getWeekStart()
    const { data: weekEntries } = await supabase
      .from('time_entries')
      .select('*')
      .gte('started_at', `${weekStart}T00:00:00`)

    // Open session
    const { data: sessionResults } = await supabase
      .from('sessions')
      .select('*')
      .is('clocked_out_at', null)
      .order('clocked_in_at', { ascending: false })
      .limit(1)

    // Open time entry
    const { data: openEntries } = await supabase
      .from('time_entries')
      .select('*')
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)

    const sessionData = sessionResults?.[0] ?? null
    const openEntry = openEntries?.[0] ?? null

    // Build today totals map
    const todayTotals: Record<string, number> = {}
    if (todayEntries) {
      for (const entry of todayEntries) {
        if (entry.duration_seconds) {
          todayTotals[entry.job_id] = (todayTotals[entry.job_id] ?? 0) + entry.duration_seconds
        }
      }
    }

    // Build weekly totals map
    const weekTotals: Record<string, number> = {}
    if (weekEntries) {
      for (const entry of weekEntries) {
        if (entry.duration_seconds) {
          weekTotals[entry.job_id] = (weekTotals[entry.job_id] ?? 0) + entry.duration_seconds
        }
      }
    }

    const mergedJobs = (jobsData ?? []).map(job => ({
      ...job,
      isRunning: openEntry?.job_id === job.id,
      startedAt: openEntry?.job_id === job.id ? new Date(openEntry.started_at).getTime() : null,
      totalSeconds: todayTotals[job.id] ?? 0,
      weeklySeconds: weekTotals[job.id] ?? 0
    }))

    setJobs(mergedJobs)
    setActiveEntry(openEntry ?? null)

    if (sessionData) {
      setSession(sessionData)
      sessionStartRef.current = new Date(sessionData.clocked_in_at).getTime()
      sessionSecondsRef.current = sessionData.total_seconds ?? 0
    }

    setLoading(false)
  }

  function getSessionSeconds(): number {
    if (!session || !sessionStartRef.current) return sessionSecondsRef.current
    return sessionSecondsRef.current + Math.floor((Date.now() - sessionStartRef.current) / 1000)
  }

  function getLiveSeconds(job: Job): number {
    const base = tab === 'today' ? (job.totalSeconds ?? 0) : (job.weeklySeconds ?? 0)
    if (!job.isRunning || !job.startedAt) return base
    return base + Math.floor((Date.now() - job.startedAt) / 1000)
  }

  function getTotalDisplaySeconds(): number {
    if (tab === 'today') return getSessionSeconds()
    return jobs.reduce((sum, j) => sum + getLiveSeconds(j), 0)
  }

  async function handleClockIn() {
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('sessions')
      .insert({ clocked_in_at: now, total_seconds: 0 })
      .select()
      .single()

    if (data) {
      setSession(data)
      sessionStartRef.current = new Date(data.clocked_in_at).getTime()
      sessionSecondsRef.current = 0

      const generalJob = jobs.find(j => j.is_general)
      if (generalJob) {
        const { data: entry } = await supabase
          .from('time_entries')
          .insert({ job_id: generalJob.id, session_id: data.id, started_at: now })
          .select()
          .single()

        setActiveEntry(entry)
        setJobs(prev => prev.map(j =>
          j.id === generalJob.id
            ? { ...j, isRunning: true, startedAt: Date.now() }
            : j
        ))
      }
    }
  }

  async function handleClockOut() {
    if (!session?.id) return
    const now = new Date().toISOString()
    const totalSeconds = getSessionSeconds()

    if (activeEntry?.id) {
      const duration = Math.floor((Date.now() - new Date(activeEntry.started_at).getTime()) / 1000)
      await supabase
        .from('time_entries')
        .update({ ended_at: now, duration_seconds: duration })
        .eq('id', activeEntry.id)

      // Update local totals immediately so they stay visible
      setJobs(prev => prev.map(j =>
        j.id === activeEntry.job_id
          ? {
              ...j,
              isRunning: false,
              startedAt: null,
              totalSeconds: (j.totalSeconds ?? 0) + duration,
              weeklySeconds: (j.weeklySeconds ?? 0) + duration
            }
          : { ...j, isRunning: false, startedAt: null }
      ))
    } else {
      setJobs(prev => prev.map(j => ({ ...j, isRunning: false, startedAt: null })))
    }

    await supabase
      .from('sessions')
      .update({ clocked_out_at: now, total_seconds: totalSeconds })
      .eq('id', session.id)

    // Keep session seconds visible after clock out
    sessionSecondsRef.current = totalSeconds
    sessionStartRef.current = null
    setSession(null)
    setActiveEntry(null)
  }

  async function handleJobClick(jobId: string) {
    if (!session?.id) return
    const now = new Date().toISOString()
    const clickedJob = jobs.find(j => j.id === jobId)
    if (!clickedJob || clickedJob.is_general) return

    if (clickedJob.isRunning) {
      if (activeEntry?.id) {
        const duration = Math.floor((Date.now() - new Date(activeEntry.started_at).getTime()) / 1000)
        await supabase
          .from('time_entries')
          .update({ ended_at: now, duration_seconds: duration })
          .eq('id', activeEntry.id)

        setJobs(prev => prev.map(j =>
          j.id === jobId
            ? {
                ...j,
                isRunning: false,
                startedAt: null,
                totalSeconds: (j.totalSeconds ?? 0) + duration,
                weeklySeconds: (j.weeklySeconds ?? 0) + duration
              }
            : j
        ))
      }

      const generalJob = jobs.find(j => j.is_general)
      if (generalJob) {
        const { data: entry } = await supabase
          .from('time_entries')
          .insert({ job_id: generalJob.id, session_id: session.id, started_at: now })
          .select()
          .single()

        setActiveEntry(entry)
        setJobs(prev => prev.map(j =>
          j.id === generalJob.id
            ? { ...j, isRunning: true, startedAt: Date.now() }
            : j
        ))
      }
    } else {
      if (activeEntry?.id) {
        const duration = Math.floor((Date.now() - new Date(activeEntry.started_at).getTime()) / 1000)
        await supabase
          .from('time_entries')
          .update({ ended_at: now, duration_seconds: duration })
          .eq('id', activeEntry.id)

        setJobs(prev => prev.map(j =>
          j.id === activeEntry.job_id
            ? {
                ...j,
                isRunning: false,
                startedAt: null,
                totalSeconds: (j.totalSeconds ?? 0) + duration,
                weeklySeconds: (j.weeklySeconds ?? 0) + duration
              }
            : j
        ))
      }

      const { data: entry } = await supabase
        .from('time_entries')
        .insert({ job_id: jobId, session_id: session.id, started_at: now })
        .select()
        .single()

      setActiveEntry(entry)
      setJobs(prev => prev.map(j =>
        j.id === jobId
          ? { ...j, isRunning: true, startedAt: Date.now() }
          : j
      ))
    }
  }

  async function addJob() {
    if (!newJobName.trim()) return
    const { data } = await supabase
      .from('jobs')
      .insert({ name: newJobName.trim(), is_general: false })
      .select()
      .single()

    if (data) {
      setJobs(prev => [...prev, { ...data, isRunning: false, startedAt: null, totalSeconds: 0, weeklySeconds: 0 }])
      setNewJobName('')
    }
  }

  async function deleteJob(id: string) {
    await supabase.from('jobs').delete().eq('id', id)
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  const generalJob = jobs.find(j => j.is_general)
  const specificJobs = jobs.filter(j => !j.is_general)
  const activeJob = jobs.find(j => j.isRunning)
  const isClockedIn = !!session

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.inner}>
          <p style={{ color: '#71717a', textAlign: 'center', paddingTop: '48px' }}>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.inner}>

        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.title}>⚙️ Metal Shop Timer</h1>
          <button className={styles.exportBtn} onClick={() => exportToCSV(jobs, getTotalDisplaySeconds(), tab)}>
            Export CSV
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'today' ? styles.tabActive : ''}`}
            onClick={() => setTab('today')}
          >
            Today
          </button>
          <button
            className={`${styles.tab} ${tab === 'week' ? styles.tabActive : ''}`}
            onClick={() => setTab('week')}
          >
            This Week
          </button>
        </div>

        {/* Clock In/Out */}
        <div className={styles.sessionBox}>
          <div>
            <p className={styles.sessionLabel}>
              {tab === 'today' ? 'Session Time' : 'Week Total'}
            </p>
            <p className={styles.sessionTime}>{formatTime(getTotalDisplaySeconds())}</p>
            {activeJob && <p className={styles.activeJob}>▶ {activeJob.name}</p>}
          </div>
          {tab === 'today' && (
            <button
              className={`${styles.clockBtn} ${isClockedIn ? styles.clockOut : styles.clockIn}`}
              onClick={isClockedIn ? handleClockOut : handleClockIn}
            >
              {isClockedIn ? 'Clock Out' : 'Clock In'}
            </button>
          )}
        </div>

        {tab === 'today' && !isClockedIn && (
          <p className={styles.hint}>Clock in to start tracking jobs</p>
        )}

        {/* General */}
        {generalJob && (
          <div className={`${styles.jobRow} ${generalJob.isRunning && tab === 'today' ? styles.jobRowActive : ''} ${!isClockedIn || tab === 'week' ? styles.jobRowDisabled : ''} ${styles.generalRow}`}>
            <div className={styles.jobLeft}>
              <div className={`${styles.dot} ${generalJob.isRunning && tab === 'today' ? styles.dotActive : ''}`} />
              <div>
                <span className={styles.jobName}>General</span>
                <span className={styles.generalHint}> — miscellaneous shop prep</span>
              </div>
            </div>
            <div className={styles.jobRight}>
              <span className={styles.jobTime}>{formatTime(getLiveSeconds(generalJob))}</span>
            </div>
          </div>
        )}

        {/* Add Job — only show on Today tab */}
        {tab === 'today' && (
          <div className={styles.addRow}>
            <input
              className={styles.input}
              type="text"
              value={newJobName}
              onChange={e => setNewJobName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addJob()}
              placeholder="Job name or address..."
            />
            <button className={styles.addBtn} onClick={addJob}>+ Add</button>
          </div>
        )}

        {/* Job List */}
        <div className={styles.jobList}>
          {specificJobs.length === 0 && (
            <p className={styles.empty}>
              {tab === 'today' ? 'No jobs yet — add one above' : 'No jobs tracked this week'}
            </p>
          )}
          {specificJobs.map(job => {
            const rowClass = [
              styles.jobRow,
              job.isRunning && tab === 'today' ? styles.jobRowActive : '',
              !isClockedIn || tab === 'week' ? styles.jobRowDisabled : ''
            ].join(' ')
            return (
              <div
                key={job.id}
                className={rowClass}
                onClick={() => tab === 'today' && handleJobClick(job.id)}
              >
                <div className={styles.jobLeft}>
                  <div className={`${styles.dot} ${job.isRunning && tab === 'today' ? styles.dotActive : ''}`} />
                  <span className={styles.jobName}>{job.name}</span>
                </div>
                <div className={styles.jobRight}>
                  <span className={styles.jobTime}>{formatTime(getLiveSeconds(job))}</span>
                  {tab === 'today' && (
                    <button className={styles.deleteBtn} onClick={e => { e.stopPropagation(); deleteJob(job.id) }}>×</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Share buttons — only on week tab */}
        {tab === 'week' && (
          <div className={styles.shareRow}>
            <button className={styles.shareBtn} onClick={() => shareViaEmail(jobs)}>
              ✉️ Send via Email
            </button>
            <button className={styles.shareBtn} onClick={() => shareViaText(jobs)}>
              💬 Send via Text
            </button>
          </div>
        )}

      </div>
    </div>
  )
}