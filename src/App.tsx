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

function exportToCSV(jobs: Job[], sessionSeconds: number) {
  const rows = [
    ['Job Name', 'Total Time'],
    ...jobs.map(j => [j.name, formatTime(j.totalSeconds ?? 0)]),
    [],
    ['Total Session Time', formatTime(sessionSeconds)]
  ]
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `job-times-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [loading, setLoading] = useState(true)
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

    const today = new Date().toISOString().slice(0, 10)
    const { data: entriesData } = await supabase
      .from('time_entries')
      .select('*')
      .gte('started_at', `${today}T00:00:00`)

    const { data: sessionResults } = await supabase
      .from('sessions')
      .select('*')
      .is('clocked_out_at', null)
      .order('clocked_in_at', { ascending: false })
      .limit(1)

    const { data: openEntries } = await supabase
      .from('time_entries')
      .select('*')
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)

    const sessionData = sessionResults?.[0] ?? null
    const openEntry = openEntries?.[0] ?? null

    const totalsMap: Record<string, number> = {}
    if (entriesData) {
      for (const entry of entriesData) {
        const secs = entry.duration_seconds ?? 0
        totalsMap[entry.job_id] = (totalsMap[entry.job_id] ?? 0) + secs
      }
    }

    const mergedJobs = (jobsData ?? []).map(job => ({
      ...job,
      isRunning: openEntry?.job_id === job.id,
      startedAt: openEntry?.job_id === job.id ? new Date(openEntry.started_at).getTime() : null,
      totalSeconds: totalsMap[job.id] ?? 0
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
    if (!session || !sessionStartRef.current) return 0
    return sessionSecondsRef.current + Math.floor((Date.now() - sessionStartRef.current) / 1000)
  }

  function getLiveSeconds(job: Job): number {
    if (!job.isRunning || !job.startedAt) return job.totalSeconds ?? 0
    return (job.totalSeconds ?? 0) + Math.floor((Date.now() - job.startedAt) / 1000)
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
    }

    await supabase
      .from('sessions')
      .update({ clocked_out_at: now, total_seconds: totalSeconds })
      .eq('id', session.id)

    setSession(null)
    setActiveEntry(null)
    sessionStartRef.current = null
    sessionSecondsRef.current = 0
    setJobs(prev => prev.map(j => ({ ...j, isRunning: false, startedAt: null })))
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
            ? { ...j, isRunning: false, startedAt: null, totalSeconds: (j.totalSeconds ?? 0) + duration }
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
            ? { ...j, isRunning: false, startedAt: null, totalSeconds: (j.totalSeconds ?? 0) + duration }
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
      setJobs(prev => [...prev, { ...data, isRunning: false, startedAt: null, totalSeconds: 0 }])
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

        <div className={styles.header}>
          <h1 className={styles.title}>⚙️ Metal Shop Timer</h1>
          <button className={styles.exportBtn} onClick={() => exportToCSV(jobs, getSessionSeconds())}>
            Export CSV
          </button>
        </div>

        <div className={styles.sessionBox}>
          <div>
            <p className={styles.sessionLabel}>Session Time</p>
            <p className={styles.sessionTime}>{formatTime(getSessionSeconds())}</p>
            {activeJob && <p className={styles.activeJob}>▶ {activeJob.name}</p>}
          </div>
          <button
            className={`${styles.clockBtn} ${isClockedIn ? styles.clockOut : styles.clockIn}`}
            onClick={isClockedIn ? handleClockOut : handleClockIn}
          >
            {isClockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </div>

        {!isClockedIn && <p className={styles.hint}>Clock in to start tracking jobs</p>}

        {generalJob && (
          <div className={`${styles.jobRow} ${generalJob.isRunning ? styles.jobRowActive : ''} ${!isClockedIn ? styles.jobRowDisabled : ''} ${styles.generalRow}`}>
            <div className={styles.jobLeft}>
              <div className={`${styles.dot} ${generalJob.isRunning ? styles.dotActive : ''}`} />
              <div>
                <span className={styles.jobName}>General</span>
                <span className={styles.generalHint}> — unallocated shop time</span>
              </div>
            </div>
            <div className={styles.jobRight}>
              <span className={styles.jobTime}>{formatTime(getLiveSeconds(generalJob))}</span>
            </div>
          </div>
        )}

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

        <div className={styles.jobList}>
          {specificJobs.length === 0 && <p className={styles.empty}>No jobs yet — add one above</p>}
          {specificJobs.map(job => {
            const rowClass = [
              styles.jobRow,
              job.isRunning ? styles.jobRowActive : '',
              !isClockedIn ? styles.jobRowDisabled : ''
            ].join(' ')
            return (
              <div key={job.id} className={rowClass} onClick={() => handleJobClick(job.id)}>
                <div className={styles.jobLeft}>
                  <div className={`${styles.dot} ${job.isRunning ? styles.dotActive : ''}`} />
                  <span className={styles.jobName}>{job.name}</span>
                </div>
                <div className={styles.jobRight}>
                  <span className={styles.jobTime}>{formatTime(getLiveSeconds(job))}</span>
                  <button className={styles.deleteBtn} onClick={e => { e.stopPropagation(); deleteJob(job.id) }}>×</button>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}