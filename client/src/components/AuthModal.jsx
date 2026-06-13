import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function AuthModal({ onClose }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
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

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {done ? (
          <>
            <p>確認メールを送信しました。メール内のリンクをクリックしてログインしてください。</p>
            <button onClick={onClose}>閉じる</button>
          </>
        ) : (
          <>
            <h2>{mode === 'login' ? 'ログイン' : 'アカウント作成'}</h2>
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
            />
            {error && <p style={styles.error}>{error}</p>}
            <button onClick={handleSubmit} disabled={loading} style={styles.button}>
              {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録'}
            </button>
            <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={styles.link}>
              {mode === 'login' ? 'アカウントを作成' : 'ログインに戻る'}
            </button>
            <button onClick={onClose} style={styles.link}>キャンセル</button>
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
  error: {
    color: 'red', fontSize: '0.875rem',
  },
  link: {
    background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.875rem',
  },
}
