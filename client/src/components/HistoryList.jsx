import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchTranscripts, deleteTranscript } from '../lib/history.js'

export function HistoryList({ onSelect, planId, historyLimit }) {
  const { t } = useTranslation()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTranscripts().then(data => {
      setList(data)
      setLoading(false)
    })
  }, [])

  const handleDelete = async (id) => {
    if (!confirm(t('history.confirmDelete'))) return
    const ok = await deleteTranscript(id)
    if (ok) setList(list.filter(t => t.id !== id))
  }

  if (loading) return <p>{t('history.loading')}</p>
  if (list.length === 0) return <p>{t('history.empty')}</p>

  return (
    <>
      <ul style={styles.list}>
        {list.map(item => (
          <li key={item.id} style={styles.item}>
            <button onClick={() => onSelect(item.result)} style={styles.title}>
              {item.filename ?? t('history.noName')}<br />
              <small>{new Date(item.created_at).toLocaleString()}</small>
            </button>
            <button onClick={() => handleDelete(item.id)} style={styles.del}>{t('history.delete')}</button>
          </li>
        ))}
      </ul>
      {planId === 'ume' && historyLimit != null && (
        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem' }}>
          無料プランでは直近{historyLimit}件まで表示されます
        </p>
      )}
    </>
  )
}

const styles = {
  list: { listStyle: 'none', padding: 0, margin: 0 },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
  title: { background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem' },
  del: { background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '0.8rem' },
}
