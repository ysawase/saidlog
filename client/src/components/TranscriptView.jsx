import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { requestSummary } from '../api.js';
import { exportTxt, exportDocx, exportPdf } from '../utils/export.js';

const SPEAKER_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];
const SPEAKER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const DUMMY_PREVIEW_HTML = `
<div class="preview-section">
  <p><strong>【会議の要点】</strong>利用者さんとの関わり方やコミュニケーション方法、および職員の対応方針について話し合われました。個別支援における声かけのタイミングや、記録の書き方についても具体的な事例をもとに確認されました。</p>
  <p><strong>【決定事項】</strong>来週の担当者会議までに、各担当者が個別支援計画の見直し案を持ち寄ることになりました。また、夜勤帯の引き継ぎ方法を統一する方向で合意しました。</p>
  <p><strong>【次にやること】</strong>①担当者会議の議題をグループLINEで共有する（山田）②支援計画の書式を更新してフォルダに保存する（佐藤）③新しい引き継ぎシートを試験運用する（全員・来週から）</p>
  <p><strong>【発言ハイライト】</strong>「記録はその日のうちに書くのが原則だけど、忙しいときは翌朝でもいいと思う」「利用者さんが落ち着かないときは、まず声かけより先に環境を整える」「担当が変わっても支援がぶれないように、もっと細かく書いた方がいい」</p>
</div>
`;

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
    Object.fromEntries(speakers.map((s, i) => [s, SPEAKER_LABELS[i] ?? String(i + 1)]))
  );
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [summaryTemplate, setSummaryTemplate] = useState('bullets');
  const [summary, setSummary] = useState('');
  const [summaryType, setSummaryType] = useState('full');
  const [summaryStatus, setSummaryStatus] = useState('idle'); // idle | loading | done | error
  const [exportError, setExportError] = useState('');
  const [upgradeMessage, setUpgradeMessage] = useState('');
  const [unavailableMessage, setUnavailableMessage] = useState('');

  const longEnough = (result.audioDurationSec ?? 0) >= 300;

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
        transcriptId: result.transcriptId ?? null,
      });
      if (data.summaryType === 'unavailable') {
        setUnavailableMessage(data.message ?? 'AI要約にはもう少し内容が必要です');
        setSummaryType('unavailable');
        setSummaryStatus('done');
        return;
      }
      setSummary(data.summary ?? '');
      setSummaryType(data.summaryType ?? 'full');
      setUpgradeMessage(data.upgradeMessage ?? '');
      setSummaryStatus('done');
    } catch (err) {
      setSummary(t('transcript.summaryError', { message: err.message }));
      setSummaryStatus('error');
    }
  }, [result.utterances, result.audioDurationSec, summaryTemplate, names, userChoseFullTrial, t, onSummaryStarted]);

  // 選択UIでどちらかのボタンが押されたら（null→値への遷移）即座に要約生成を開始する
  const prevChoiceRef = useRef(userChoseFullTrial);
  useEffect(() => {
    if (prevChoiceRef.current === null && userChoseFullTrial !== null && longEnough) {
      generateSummary();
    }
    prevChoiceRef.current = userChoseFullTrial;
  }, [userChoseFullTrial, generateSummary, longEnough]);

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

  const markdownComponents = {
    h1: ({ children }) => <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: '0.25rem 0 0' }}>{children}</p>,
    h2: ({ children }) => <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: '0.25rem 0 0' }}>{children}</p>,
    h3: ({ children }) => <p style={{ fontWeight: 'bold', fontSize: '0.95rem', margin: '0.15rem 0 0' }}>{children}</p>,
    ul: ({ children }) => <ul style={{ margin: '0.1rem 0', paddingLeft: '1.25rem', lineHeight: '1.4' }}>{children}</ul>,
    li: ({ children }) => <li style={{ margin: '0' }}>{children}</li>,
  };

  return (
    <div className="transcript">
      <div className="transcript-toolbar">
        {speakers.length > 1 && (
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
        )}
        <button className="btn secondary" onClick={copyTranscript}>
          {copied ? t('transcript.copied') : t('transcript.copy')}
        </button>
        <button
          className="btn secondary"
          onClick={exportRaw}
          disabled={exporting !== null || !canExport}
          title={!canExport ? '竹プランで利用できます' : undefined}
        >
          {exporting === 'raw' ? t('transcript.saving') : t('transcript.saveRaw')}
        </button>
        {!canExport && <span style={{ color: '#6b7280', fontSize: '0.8rem', marginLeft: '0.5rem' }}>エクスポートは竹プランで利用できます</span>}
        {canExport && exportError && <span style={{ color: '#dc2626', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{exportError}</span>}
      </div>

      <div className="summary-section">
        {!longEnough ? (
          <div style={{ padding: '1rem', background: '#f3f4f6', borderRadius: '8px', lineHeight: '1.8' }}>
            <p style={{ margin: '0 0 0.25rem', fontWeight: 'bold' }}>音声が短いです。5分以上の音声であれば、『AI議事録ツール』機能が解放されます。</p>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.9rem', color: '#4b5563' }}>決定事項・次にやることをAIが自動で整理します。</p>
            <hr style={{ margin: '0 0 1.25rem', border: 'none', borderTop: '1px solid #d1d5db' }} />
            <p style={{ margin: '0 0 0.25rem', fontWeight: 'bold' }}>さらに竹プランにアップグレードすると、『詳細議事録・エクスポート』機能が解放されます。</p>
            <p style={{ margin: '0', fontSize: '0.9rem', color: '#4b5563' }}>月額880円で、詳細な議事録の生成・テキストエクスポート・履歴30件保存が使えます。</p>
          </div>
        ) : (
        <>
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
        {summaryStatus === 'done' && summaryType === 'unavailable' && (
          <div className="summary-unavailable">
            <p className="summary-unavailable-title">{unavailableMessage}</p>
            <p className="summary-unavailable-sub">録音内容が短いため、決定事項やTODOを十分に整理できませんでした</p>
          </div>
        )}
        {summaryStatus === 'done' && summaryType === 'preview' && (
          <div className="summary-result">
            <ReactMarkdown components={markdownComponents}>{summary}</ReactMarkdown>
            <div className="summary-blur-wrapper">
              <div className="summary-blur-content" aria-hidden="true" dangerouslySetInnerHTML={{ __html: DUMMY_PREVIEW_HTML }} />
              <div className="summary-blur-overlay">
                <div className="summary-upgrade-card">
                  {upgradeMessage && <p className="summary-upgrade-message">{upgradeMessage}</p>}
                  <button className="btn summary-upgrade-btn">竹プランを見る</button>
                </div>
              </div>
            </div>
          </div>
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
            <div className="summary-result"><ReactMarkdown components={markdownComponents}>{summary}</ReactMarkdown></div>
          </>
        )}
        </>
        )}
      </div>

      <ul className="utterance-list">
        {result.utterances.map((u, i) => (
          <li key={i} className="utterance">
            <span className="timestamp">{formatTime(u.startMs)}</span>
            {speakers.length > 1 && (
              <span className="speaker-name" style={{ color: colorOf(u.speaker) }}>
                {names[u.speaker]}：
              </span>
            )}
            <span className="utterance-text">{u.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
