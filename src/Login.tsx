import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabaseClient'
import styles from './Login.module.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>🔥 Shop Timer</h1>
        <p className={styles.subtitle}>Sign in to continue</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="username"
            required
          />
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
