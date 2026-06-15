import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestSummary } from '../api.js';
import { exportTxt, exportDocx, exportPdf } from '../utils/export.js';

const SPEAKER_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TranscriptView({ result, userChoseFullTrial = null, canExport = true, summaryTrialPending = false, onSummaryStarted }) {
  const { t } = useTranslation();
  const speakers = useMemo(
    () => [...new Set(result.utterances.map((u) => u.speaker))],
    [result]
  );

  const [names, setNames] = useState(() =>
    Object.fromEntries(speakers.map((s) => [s, t('transcript.speakerLabel', { s })]))
  );
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [summaryTemplate, setSummaryTemplate] = useState('bullets');
  const [summary, setSummary] = useState('');
  const [summaryType, setSummaryType] = useState('full');
  const [summaryStatus, setSummaryStatus] = useState('idle'); // idle | loading | done | error
  const [exportError, setExportError] = useState('');

  const colorOf = (speaker) =>
    SPEAKER_COLORS[speakers.indexOf(speaker) % SPEAKER_COLORS.length];

  useEffect(() => {
    if (!minutesOpen) return;
    const close = () => setMinutesOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [minutesOpen]);

  const generateSummary = useCallback(async () => {
    onSummaryStarted?.();
    setSummaryStatus('loading');
    try {
      const data = await requestSummary({
        utterances: result.utterances,
        template: summaryTemplate,
        names,
        userChoseFullTrial: userChoseFullTrial ?? false,
        audioDurationSec: result.audioDurationSec ?? 0,
      });
      setSummary(data.summary ?? '');
      setSummaryType(data.summaryType ?? 'full');
      setSummaryStatus('done');
    } catch (err) {
      setSummary(t('transcript.summaryError', { message: err.message }));
      setSummaryStatus('error');
    }
  }, [result.utterances, result.audioDurationSec, summaryTemplate, names, userChoseFullTrial, t, onSummaryStarted]);

  // 選択UIでどちらかのボタンが押されたら（null→値への遷移）即座に要約生成を開始する
  const prevChoiceRef = useRef(userChoseFullTrial);
  useEffect(() => {
    if (prevChoiceRef.current === null && userChoseFullTrial !== null) {
      generateSummary();
    }
    prevChoiceRef.current = userChoseFullTrial;
  }, [userChoseFullTrial, generateSummary]);

  const exportRaw = async () => {
    if (!canExport) {
      setExportError('エクスポートは竹プランで利用できます');
      return;
    }
    setExportError('');
    setExporting('raw');
    try {
      await exportTxt(result.utterances, names, '');
    } finally {
      setExporting(null);
    }
  };

  const exportMinutes = async (format) => {
    setMinutesOpen(false);
    if (!canExport) {
      setExportError('エクスポートは竹プランで利用できます');
      return;
    }
    setExportError('');
    setExporting(format);
    try {
      if (format === 'txt') await exportTxt([], names, summary);
      else if (format === 'docx') await exportDocx([], names, summary);
      else if (format === 'pdf') await exportPdf([], names, summary);
    } catch (err) {
      if (err.message?.includes('403')) {
        setExportError('エクスポートは竹プランで利用できます');
      }
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
    return <div className="notice">{t('transcript.noResult')}</div>;
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
                aria-label={t('transcript.speakerLabel', { s })}
              />
              <span className="pen-icon" aria-hidden="true">
                {t('transcript.editIcon')}
              </span>
            </label>
          ))}
        </div>
        <button className="btn secondary" onClick={copyTranscript}>
          {copied ? t('transcript.copied') : t('transcript.copy')}
        </button>
        <button
          className="btn secondary"
          onClick={exportRaw}
          disabled={exporting !== null}
          style={!canExport ? { opacity: 0.5 } : undefined}
        >
          {exporting === 'raw' ? t('transcript.saving') : t('transcript.saveRaw')}
        </button>
        {exportError && <span style={{ color: '#dc2626', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{exportError}</span>}
      </div>

      <div className="summary-section">
        {!(summaryStatus === 'done' && summaryType === 'preview') && <div className="summary-controls">
          <select
            value={summaryTemplate}
            onChange={(e) => setSummaryTemplate(e.target.value)}
            disabled={summaryStatus === 'loading'}
            aria-label={t('transcript.summaryTemplate')}
          >
            <option value="bullets">{t('transcript.bullets')}</option>
            <option value="minutes">{t('transcript.minutes')}</option>
          </select>
          {!summaryTrialPending && summaryStatus !== 'loading' && (
            <button
              className="btn secondary"
              onClick={generateSummary}
            >
              {t('transcript.generateSummary')}
            </button>
          )}
        </div>}
        {summaryStatus === 'error' && <div className="notice error">{summary}</div>}
        {summaryStatus === 'done' && summaryType === 'preview' && (
          <>
            <p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 0.5rem' }}>AI要約プレビュー</p>
            <div className="summary-result">{summary.split('\n\n')[0]}</div>
            <p style={{ fontSize: '0.8rem', color: '#888', margin: '0.75rem 0 0.25rem' }}>
              詳細な要約・決定事項・次にやることは竹プランで利用できます。
            </p>
            <p style={{ color: '#aaa', fontSize: '0.85rem', margin: '0.25rem 0' }}>決定事項 🔒</p>
            <p style={{ color: '#aaa', fontSize: '0.85rem', margin: '0.25rem 0' }}>次にやること 🔒</p>
            <p style={{ color: '#aaa', fontSize: '0.85rem', margin: '0.25rem 0' }}>エクスポート 🔒</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem' }}>竹プランで利用する（※現在準備中）</p>
          </>
        )}
        {summaryStatus === 'done' && summaryType === 'full' && (
          <>
            <p style={{ fontSize: '0.8rem', color: '#888' }}>
              {t('transcript.summaryNote')}
            </p>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                className="btn secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  setMinutesOpen((o) => !o);
                }}
                disabled={exporting !== null}
                style={!canExport ? { opacity: 0.5 } : undefined}
              >
                {minutesExporting ? t('transcript.savingMinutes') : t('transcript.saveMinutes')}
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
