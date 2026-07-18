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

export default function TranscriptView({ result, userChoseFullTrial = null, canExport = true, summaryTrialPending = false, onSummaryStarted, upgradeMode, onUpgrade, onRetry, isLoggedIn, onOpenAuthModal }) {
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
  const [showCopyModal, setShowCopyModal] = useState(false);

  const longEnough = (result.audioDurationSec ?? 0) >= 180;
  const showSummaryUI = longEnough || upgradeMode === 'plus_active';

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
    if (prevChoiceRef.current === null && userChoseFullTrial !== null && showSummaryUI) {
      generateSummary();
    }
    prevChoiceRef.current = userChoseFullTrial;
  }, [userChoseFullTrial, generateSummary, showSummaryUI]);

  const exportRaw = async () => {
    if (!canExport) {
      setShowCopyModal(true);
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
      setShowCopyModal(true);
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
        setExportError('エクスポートはSaidLog Plusで利用できます');
      }
    } finally {
      setExporting(null);
    }
  };

  const copyTranscript = async () => {
    if (!canExport) {
      setShowCopyModal(true);
      return;
    }
    const text = result.utterances
      .map((u) => `${names[u.speaker]}：${u.text}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parseBulletCards = (markdown) => {
    const lines = markdown.split('\n');
    let section = null;
    const decisions = [];
    const actions = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^##\s*決定事項/.test(trimmed)) { section = 'decisions'; continue; }
      if (/^##\s*(アクションアイテム|次のアクション)/.test(trimmed)) { section = 'actions'; continue; }
      if (trimmed.startsWith('#')) { section = null; continue; }
      if (section === 'decisions' && trimmed) decisions.push(line);
      if (section === 'actions' && trimmed) actions.push(line);
    }
    return { decisions, actions };
  };

  const bulletCards = summaryStatus === 'done' && summaryType === 'full' && summaryTemplate === 'bullets'
    ? parseBulletCards(summary)
    : null;

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
    <>
    {showCopyModal && (
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}
        onClick={() => setShowCopyModal(false)}
      >
        <div
          style={{
            background: '#fff', borderRadius: '12px', padding: '1.5rem',
            maxWidth: '320px', width: '90%', textAlign: 'center',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {!isLoggedIn ? (
            <>
              <p>無料登録するとエクスポートできます</p>
              <button className="btn primary" onClick={() => { setShowCopyModal(false); onOpenAuthModal(); }}>
                無料登録 / ログイン
              </button>
              <button className="btn secondary" onClick={() => setShowCopyModal(false)}>閉じる</button>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 'bold', margin: '0 0 8px' }}>コピー・エクスポートはSaidLog Plusで使えます</p>
              <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0 0 16px' }}>月680円で月10時間まで。会議メモのコピー・エクスポートに対応します。</p>
              {upgradeMode === 'plus_active' ? (
                <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#4b5563' }}>
                  SaidLog Plus利用中です
                </p>
              ) : upgradeMode === 'web' ? (
                <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#4b5563' }}>
                  SaidLog PlusはAndroidアプリ版でご利用いただけます。
                  {/* TODO: Google Play 申請完了後、ここをストアリンクに差し替える */}
                </p>
              ) : upgradeMode === 'account_error' ? (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#b91c1c' }}>プラン情報を確認できませんでした</p>
                  <button className="btn secondary" onClick={() => { setShowCopyModal(false); onRetry(); }}>再試行</button>
                </>
              ) : upgradeMode === 'loading' ? (
                <button className="btn primary" disabled>確認中...</button>
              ) : (
                <button className="btn primary" onClick={() => { setShowCopyModal(false); onUpgrade(); }}>SaidLog Plusに進む</button>
              )}
              <button className="btn secondary" onClick={() => setShowCopyModal(false)}>閉じる</button>
            </>
          )}
        </div>
      </div>
    )}
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
          disabled={exporting !== null}
        >
          {exporting === 'raw' ? t('transcript.saving') : t('transcript.saveRaw')}
        </button>
        {exportError && <span style={{ color: '#dc2626', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{exportError}</span>}
      </div>

      <div className="summary-section">
        {!showSummaryUI ? (
          <div style={{ padding: '1rem', background: '#f3f4f6', borderRadius: '8px', lineHeight: '1.8' }}>
            <p style={{ margin: '0 0 0.25rem', fontWeight: 'bold' }}>音声が短いです。3分以上の音声であれば、『AI議事録ツール』機能が解放されます。</p>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.9rem', color: '#4b5563' }}>決定事項・次にやることをAIが自動で整理します。</p>
            <hr style={{ margin: '0 0 1.25rem', border: 'none', borderTop: '1px solid #d1d5db' }} />
            <p style={{ margin: '0 0 0.25rem', fontWeight: 'bold' }}>さらにSaidLog Plusにアップグレードすると、『詳細議事録・エクスポート』機能が解放されます。</p>
            <p style={{ margin: '0', fontSize: '0.9rem', color: '#4b5563' }}>月額680円で、詳細な議事録の生成・テキストエクスポート・履歴30件保存が使えます。月10時間まで利用可能。</p>
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
                  {upgradeMode === 'plus_active' ? null
                   : upgradeMode === 'web' ? (
                    <p style={{ fontSize: '0.9rem', color: '#4b5563', margin: 0 }}>
                      SaidLog PlusはAndroidアプリ版でご利用いただけます。
                      {/* TODO: Google Play 申請完了後、ここをストアリンクに差し替える */}
                    </p>
                   ) : upgradeMode === 'account_error' ? (
                    <>
                      <p style={{ fontSize: '0.9rem', color: '#b91c1c', margin: '0 0 8px' }}>プラン情報を確認できませんでした</p>
                      <button className="btn summary-upgrade-btn" onClick={onRetry}>再試行</button>
                    </>
                   ) : upgradeMode === 'loading' ? (
                    <button className="btn summary-upgrade-btn" disabled>確認中...</button>
                   ) : upgradeMode === 'not_logged_in' ? (
                    <button className="btn summary-upgrade-btn" onClick={onUpgrade}>無料登録 / ログイン</button>
                   ) : (
                    <button className="btn summary-upgrade-btn" onClick={onUpgrade}>SaidLog Plusに進む</button>
                   )}
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
            {bulletCards ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                {[
                  { heading: '決定したこと', lines: bulletCards.decisions },
                  { heading: '次にやること', lines: bulletCards.actions },
                ].map(({ heading, lines }) => (
                  <div key={heading} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px' }}>
                    <p style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 8px' }}>{heading}</p>
                    {lines.length > 0 ? (
                      <div style={{ fontSize: '14px', lineHeight: '1.7' }}>
                        <ReactMarkdown components={markdownComponents}>{lines.join('\n')}</ReactMarkdown>
                      </div>
                    ) : (
                      <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0 }}>今回は該当なし</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="summary-result"><ReactMarkdown components={markdownComponents}>{summary}</ReactMarkdown></div>
            )}
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
    </>
  );
}
