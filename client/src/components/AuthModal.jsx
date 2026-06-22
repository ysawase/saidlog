import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext.jsx'
import { deleteAccount } from '../api.js'

export function AuthModal({ onClose, user, initialMode }) {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const [mode, setMode] = useState(initialMode ?? 'login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async () => {
    setError(null)
    setLoading(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else onClose()
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setDone(true)
    }
    setLoading(false)
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm(t('auth.deleteConfirm'))) return
    setError(null)
    setLoading(true)
    try {
      await deleteAccount()
      await signOut()
      onClose()
    } catch (err) {
      setError(t('auth.deleteError'))
    }
    setLoading(false)
  }

  if (user) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#555' }}>{user.email}</p>
          {error && <p style={styles.error}>{error}</p>}
          <button
            onClick={handleDeleteAccount}
            disabled={loading}
            style={styles.deleteButton}
          >
            {loading ? t('auth.deleting') : t('auth.deleteAccount')}
          </button>
          <button onClick={onClose} style={styles.link}>{t('auth.cancel')}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {done ? (
          <>
            <p>{t('auth.confirmEmail')}</p>
            <button onClick={onClose}>{t('auth.close')}</button>
          </>
        ) : (
          <>
            <h2>{mode === 'login' ? t('auth.login') : t('auth.signup')}</h2>
            <input
              type="email"
              placeholder={t('auth.email')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
              placeholder={t('auth.password')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
            />
            {error && <p style={styles.error}>{error}</p>}
            <button onClick={handleSubmit} disabled={loading} style={styles.button}>
              {loading ? t('auth.processing') : mode === 'login' ? t('auth.submit.login') : t('auth.submit.signup')}
            </button>
            <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={styles.link}>
              {mode === 'login' ? t('auth.switchToSignup') : t('auth.switchToLogin')}
            </button>
            <button onClick={onClose} style={styles.link}>{t('auth.cancel')}</button>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff', padding: '2rem', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', gap: '0.75rem',
    width: '320px',
  },
  input: {
    padding: '0.5rem', fontSize: '1rem', border: '1px solid #ccc', borderRadius: '4px',
  },
  button: {
    padding: '0.6rem', fontSize: '1rem', cursor: 'pointer',
  },
  deleteButton: {
    padding: '0.6rem', fontSize: '1rem', cursor: 'pointer',
    background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px',
  },
  error: {
    color: 'red', fontSize: '0.875rem',
  },
  link: {
    background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.875rem',
  },
}
