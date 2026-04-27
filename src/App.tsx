import { useState, useEffect, useRef } from 'react'
import styles from './App.module.css'

interface Job {
  id: string
  name: string
  totalSeconds: number
  isRunning: boolean
  startedAt: number | null
  isGeneral: boolean
}

interface Session {
  clockedIn: boolean
  clockInTime: number | null
  totalSessionSeconds: number
}

const JOBS_KEY = 'metalshop_jobs'
const SESSION_KEY = 'metalshop_session'

const GENERAL_JOB: Job = {
  id: 'general',
  name: 'General',
  totalSeconds: 0,
  isRunning: false,
  startedAt: null,
  isGeneral: true
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
    ...jobs.map(j => [j.name, formatTime(j.totalSeconds)]),
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
  const [jobs, setJobs] = useState<Job[]>(() => {
    const saved = localStorage.getItem(JOBS_KEY)
    if (saved) {
      const parsed: Job[] = JSON.parse(saved)
      // Ensure General always exists
      if (!parsed.find(j => j.id === 'general')) {
        return [GENERAL_JOB, ...parsed]
      }
      return parsed
    }
    return [GENERAL_JOB]
  })

  const [session, setSession] = useState<Session>(() => {
    const saved = localStorage.getItem(SESSION_KEY)
    return saved ? JSON.parse(saved) : { clockedIn: false, clockInTime: null, totalSessionSeconds: 0 }
  })

  const [newJobName, setNewJobName] = useState('')
  const [, setTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => setTick(t => t + 1), 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  useEffect(() => {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs))
  }, [jobs])

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }, [session])

  function getLiveSeconds(job: Job): number {
    if (!job.isRunning || !job.startedAt) return job.totalSeconds
    return job.totalSeconds + Math.floor((Date.now() - job.startedAt) / 1000)
  }

  function getSessionSeconds(): number {
    if (!session.clockedIn || !session.clockInTime) return session.totalSessionSeconds
    return session.totalSessionSeconds + Math.floor((Date.now() - session.clockInTime) / 1000)
  }

  // Stop all jobs and return updated list, optionally starting General
  function stopAllJobs(jobs: Job[], now: number, startGeneral = false): Job[] {
    return jobs.map(job => {
      if (job.isRunning) {
        return {
          ...job,
          isRunning: false,
          totalSeconds: job.totalSeconds + Math.floor((now - (job.startedAt ?? now)) / 1000),
          startedAt: null
        }
      }
      if (startGeneral && job.id === 'general') {
        return { ...job, isRunning: true, startedAt: now }
      }
      return job
    })
  }

  function handleJobClick(id: string) {
    if (!session.clockedIn) return
    if (id === 'general') return // General is automatic, not manually clickable
    const now = Date.now()
    setJobs(prev => {
      const target = prev.find(j => j.id === id)
      if (!target) return prev

      if (target.isRunning) {
        // Stop this job → restart General
        return prev.map(job => {
          if (job.id === id) {
            return { ...job, isRunning: false, totalSeconds: job.totalSeconds + Math.floor((now - (job.startedAt ?? now)) / 1000), startedAt: null }
          }
          if (job.id === 'general') {
            return { ...job, isRunning: true, startedAt: now }
          }
          return job
        })
      } else {
        // Start this job → stop everything else including General
        return prev.map(job => {
          if (job.id === id) {
            return { ...job, isRunning: true, startedAt: now }
          }
          if (job.isRunning) {
            return { ...job, isRunning: false, totalSeconds: job.totalSeconds + Math.floor((now - (job.startedAt ?? now)) / 1000), startedAt: null }
          }
          return job
        })
      }
    })
  }

  function handleClockInOut() {
    const now = Date.now()
    if (!session.clockedIn) {
      // Clock in → start General automatically
      setJobs(prev => prev.map(job =>
        job.id === 'general' ? { ...job, isRunning: true, startedAt: now } : job
      ))
      setSession({ clockedIn: true, clockInTime: now, totalSessionSeconds: session.totalSessionSeconds })
    } else {
      // Clock out → stop everything
      setJobs(prev => stopAllJobs(prev, now, false))
      setSession({
        clockedIn: false,
        clockInTime: null,
        totalSessionSeconds: session.totalSessionSeconds + Math.floor((now - (session.clockInTime ?? now)) / 1000)
      })
    }
  }

  function addJob() {
    if (!newJobName.trim()) return
    setJobs(prev => [...prev, {
      id: crypto.randomUUID(),
      name: newJobName.trim(),
      totalSeconds: 0,
      isRunning: false,
      startedAt: null,
      isGeneral: false
    }])
    setNewJobName('')
  }

  function deleteJob(id: string) {
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  function resetAll() {
    if (!confirm('Reset all job times and session? This cannot be undone.')) return
    setJobs(prev => prev.map(j => ({ ...j, totalSeconds: 0, isRunning: false, startedAt: null })))
    setSession({ clockedIn: false, clockInTime: null, totalSessionSeconds: 0 })
  }

  const generalJob = jobs.find(j => j.id === 'general')!
  const specificJobs = jobs.filter(j => j.id !== 'general')
  const activeJob = jobs.find(j => j.isRunning)

  return (
    <div className={styles.container}>
      <div className={styles.inner}>

        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.title}>⚙️ Metal Shop Timer</h1>
          <button className={styles.exportBtn} onClick={() => exportToCSV(jobs, getSessionSeconds())}>
            Export CSV
          </button>
        </div>

        {/* Clock In/Out */}
        <div className={styles.sessionBox}>
          <div>
            <p className={styles.sessionLabel}>Session Time</p>
            <p className={styles.sessionTime}>{formatTime(getSessionSeconds())}</p>
            {activeJob && <p className={styles.activeJob}>▶ {activeJob.name}</p>}
          </div>
          <button
            className={`${styles.clockBtn} ${session.clockedIn ? styles.clockOut : styles.clockIn}`}
            onClick={handleClockInOut}
          >
            {session.clockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </div>

        {!session.clockedIn && <p className={styles.hint}>Clock in to start tracking jobs</p>}

        {/* General (always shown, not clickable) */}
        <div className={`${styles.jobRow} ${generalJob.isRunning ? styles.jobRowActive : ''} ${!session.clockedIn ? styles.jobRowDisabled : ''} ${styles.generalRow}`}>
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

        {/* Add Job */}
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

        {/* Specific Jobs */}
        <div className={styles.jobList}>
          {specificJobs.length === 0 && <p className={styles.empty}>No jobs yet — add one above</p>}
          {specificJobs.map(job => {
            const rowClass = [
              styles.jobRow,
              job.isRunning ? styles.jobRowActive : '',
              !session.clockedIn ? styles.jobRowDisabled : ''
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

        {jobs.length > 1 && (
          <div className={styles.resetRow}>
            <button className={styles.resetBtn} onClick={resetAll}>Reset all times</button>
          </div>
        )}

      </div>
    </div>
  )
}