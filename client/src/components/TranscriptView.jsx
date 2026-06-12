import { useMemo, useState } from 'react';

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
  const [summaryTemplate, setSummaryTemplate] = useState('bullets');
  const [summary, setSummary] = useState('');
  const [summaryStatus, setSummaryStatus] = useState('idle'); // idle | loading | done | error

  const colorOf = (speaker) =>
    SPEAKER_COLORS[speakers.indexOf(speaker) % SPEAKER_COLORS.length];

  const generateSummary = async () => {
    setSummaryStatus('loading');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          utterances: result.utterances,
          template: summaryTemplate,
          names,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSummary(data.summary);
      setSummaryStatus('done');
    } catch (err) {
      setSummary(`要約エラー: ${err.message}`);
      setSummaryStatus('error');
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
