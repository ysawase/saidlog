import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchTranscripts, deleteTranscript } from '../lib/history.js'

function formatDate(isoString) {
  const d = new Date(isoString)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(sec) {
  if (!sec || sec < 0) return null
  if (sec < 60) return `${Math.round(sec)}秒`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s === 0 ? `${m}分` : `${m}分${s}秒`
}

function getChipLabel(summaryType) {
  if (summaryType === 'full') return '要約済み'
  if (summaryType === 'preview') return '要約プレビュー'
  return '文字起こし済み'
}

function getChipStyle(summaryType) {
  if (summaryType === 'full')    return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }
  if (summaryType === 'preview') return { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }
  return { background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }
}

export function HistoryList({ onSelect, upgradeMode, onUpgrade }) {
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
    if (ok) setList(list.filter(item => item.id !== id))
  }

  if (loading) return <p>{t('history.loading')}</p>
  if (list.length === 0) return <p>{t('history.empty')}</p>

  return (
    <>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {list.map(item => {
          const duration = formatDuration(item.result?.audioDurationSec)
          const chip = getChipLabel(item.summary_type)
          const chipStyle = getChipStyle(item.summary_type)
          return (
            <li key={item.id} style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #eee' }}>
              <button
                onClick={() => onSelect(item.result)}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: '56px',
                  padding: '10px 8px',
                }}
              >
                <div style={{ fontWeight: '500', fontSize: '0.9rem', color: '#111827' }}>
                  {item.filename ?? t('history.noName')}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px', fontSize: '0.75rem', color: '#6b7280' }}>
                  <span>{formatDate(item.created_at)}</span>
                  {duration && <span>· {duration}</span>}
                  <span style={{ ...chipStyle, borderRadius: '4px', padding: '1px 6px' }}>
                    {chip}
                  </span>
                </div>
              </button>
              <button
                onClick={() => handleDelete(item.id)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.8rem', padding: '0 8px', flexShrink: 0 }}
              >
                {t('history.delete')}
              </button>
            </li>
          )
        })}
      </ul>

      {(upgradeMode === 'web' || upgradeMode === 'purchase' || upgradeMode === 'loading') && (
        <div style={{ marginTop: '1rem', padding: '12px', background: '#f9fafb', borderRadius: '8px', fontSize: '0.8rem' }}>
          <p style={{ margin: '0 0 4px', color: '#374151' }}>無料プランでは直近3件まで表示されます</p>
          <p style={{ margin: '0 0 10px', color: '#6b7280' }}>SaidLog Plusなら直近30件まで・月680円</p>
          {upgradeMode === 'web' ? (
            <p style={{ margin: 0, color: '#4b5563', fontSize: '0.8rem' }}>
              SaidLog PlusはAndroidアプリ版でご利用いただけます。
              {/* TODO: Google Play 申請完了後、ここをストアリンクに差し替える */}
            </p>
          ) : upgradeMode === 'loading' ? (
            <button className="btn primary" disabled style={{ fontSize: '0.8rem', padding: '6px 14px', marginBottom: 0 }}>確認中...</button>
          ) : (
            <button className="btn primary" onClick={onUpgrade} style={{ fontSize: '0.8rem', padding: '6px 14px', marginBottom: 0 }}>SaidLog Plusに進む</button>
          )}
        </div>
      )}
    </>
  )
}
