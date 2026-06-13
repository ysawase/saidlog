import { useEffect, useMemo, useState } from 'react';
import { requestSummary } from '../api.js';
import { exportTxt, exportDocx, exportPdf } from '../utils/export.js';

const SPEAKER_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TranscriptView({ result }) {
  const speakers = useMemo(
    () => [...new Set(result.utterances.map((u) => u.speaker))],
    [result]
  );

  // 話者ラベル(A, B, ...)から表示名へのマップ。ユーザーが編集できる。
  const [names, setNames] = useState(() =>
    Object.fromEntries(speakers.map((s) => [s, `話者${s}`]))
  );
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [summaryTemplate, setSummaryTemplate] = useState('bullets');
  const [summary, setSummary] = useState('');
  const [summaryStatus, setSummaryStatus] = useState('idle'); // idle | loading | done | error

  const colorOf = (speaker) =>
    SPEAKER_COLORS[speakers.indexOf(speaker) % SPEAKER_COLORS.length];

  useEffect(() => {
    if (!minutesOpen) return;
    const close = () => setMinutesOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [minutesOpen]);

  const generateSummary = async () => {
    setSummaryStatus('loading');
    try {
      const data = await requestSummary({
        utterances: result.utterances,
        template: summaryTemplate,
        names,
      });
      setSummary(data.summary);
      setSummaryStatus('done');
    } catch (err) {
      setSummary(`要約エラー: ${err.message}`);
      setSummaryStatus('error');
    }
  };

  const exportRaw = async () => {
    setExporting('raw');
    try {
      await exportTxt(result.utterances, names, '');
    } finally {
      setExporting(null);
    }
  };

  const exportMinutes = async (format) => {
    setMinutesOpen(false);
    setExporting(format);
    try {
      if (format === 'txt') await exportTxt([], names, summary);
      else if (format === 'docx') await exportDocx([], names, summary);
      else if (format === 'pdf') await exportPdf([], names, summary);
    } finally {
      setExporting(null);
    }
  };

  const copyTranscript = async () => {
    const text = result.utterances
      .map((u) => `${names[u.speaker]}：${u.text}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (result.utterances.length === 0) {
    return <div className="notice">発言が検出されませんでした。</div>;
  }

  const minutesExporting = exporting !== null && exporting !== 'raw';

  return (
    <div className="transcript">
      <div className="transcript-toolbar">
        <div className="speaker-legend">
          {speakers.map((s) => (
            <label key={s} className="speaker-chip" style={{ borderColor: colorOf(s) }}>
              <span className="speaker-dot" style={{ background: colorOf(s) }} />
              <input
                value={names[s]}
                onChange={(e) => setNames({ ...names, [s]: e.target.value })}
                aria-label={`話者${s}の名前`}
              />
              <span className="pen-icon" aria-hidden="true">
                ✎
              </span>
            </label>
          ))}
        </div>
        <button className="btn secondary" onClick={copyTranscript}>
          {copied ? 'コピーしました ✓' : 'テキストをコピー'}
        </button>
        <button
          className="btn secondary"
          onClick={exportRaw}
          disabled={exporting !== null}
        >
          {exporting === 'raw' ? '生成中…' : '原文を保存'}
        </button>
      </div>

      <div className="summary-section">
        <div className="summary-controls">
          <select
            value={summaryTemplate}
            onChange={(e) => setSummaryTemplate(e.target.value)}
            disabled={summaryStatus === 'loading'}
            aria-label="要約テンプレート"
          >
            <option value="bullets">決定事項・アクションアイテム</option>
            <option value="minutes">議事録形式</option>
          </select>
          <button
            className="btn secondary"
            onClick={generateSummary}
            disabled={summaryStatus === 'loading'}
          >
            {summaryStatus === 'loading' ? '生成中…' : '要約を生成'}
          </button>
        </div>
        {summaryStatus === 'error' && <div className="notice error">{summary}</div>}
        {summaryStatus === 'done' && (
          <>
            <p style={{ fontSize: '0.8rem', color: '#888' }}>
              AIによる自動要約です。内容は必ずご確認ください。
            </p>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                className="btn secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  setMinutesOpen((o) => !o);
                }}
                disabled={exporting !== null}
              >
                {minutesExporting ? '生成中…' : '議事録を保存 ▼'}
              </button>
              {minutesOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    zIndex: 10,
                    background: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: '100%',
                    marginTop: '4px',
                  }}
                >
                  {['txt', 'docx', 'pdf'].map((fmt) => (
                    <button
                      key={fmt}
                      className="btn secondary"
                      onClick={() => exportMinutes(fmt)}
                      style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid #eee' }}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="summary-result">{summary}</div>
          </>
        )}
      </div>

      <ul className="utterance-list">
        {result.utterances.map((u, i) => (
          <li key={i} className="utterance">
            <span className="timestamp">{formatTime(u.startMs)}</span>
            <span className="speaker-name" style={{ color: colorOf(u.speaker) }}>
              {names[u.speaker]}：
            </span>
            <span className="utterance-text">{u.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
