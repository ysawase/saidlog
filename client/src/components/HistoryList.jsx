import { useEffect, useState } from 'react'
import { fetchTranscripts, deleteTranscript } from '../lib/history.js'

export function HistoryList({ onSelect }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTranscripts().then(data => {
      setList(data)
      setLoading(false)
    })
  }, [])

  const handleDelete = async (id) => {
    if (!confirm('この履歴を削除しますか？')) return
    const ok = await deleteTranscript(id)
    if (ok) setList(list.filter(t => t.id !== id))
  }

  if (loading) return <p>読み込み中...</p>
  if (list.length === 0) return <p>履歴がありません</p>

  return (
    <ul style={styles.list}>
      {list.map(t => (
        <li key={t.id} style={styles.item}>
          <button onClick={() => onSelect(t.result)} style={styles.title}>
            {t.filename ?? '無題'}<br />
            <small>{new Date(t.created_at).toLocaleString('ja-JP')}</small>
          </button>
          <button onClick={() => handleDelete(t.id)} style={styles.del}>削除</button>
        </li>
      ))}
    </ul>
  )
}

const styles = {
  list: { listStyle: 'none', padding: 0, margin: 0 },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
  title: { background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem' },
  del: { background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '0.8rem' },
}
