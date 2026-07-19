import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Recorder from './components/Recorder.jsx';
import TranscriptView from './components/TranscriptView.jsx';
import { uploadAudio, requestTranscription, getAudioDuration, getAccountStatus } from './api.js';
import { recordingFileName, downloadBlob } from './lib/recorder.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { AuthModal } from './components/AuthModal.jsx';
import { saveTranscript } from './lib/history.js';
import { HistoryList } from './components/HistoryList.jsx';
import { initBilling, purchaseTake, restorePurchases } from './lib/billing';
import { getUpgradeMode } from './lib/upgradeGuard';
import { getOrCreateGuestId } from './lib/guestId';
import { trackEvent, planStateFromPlanId } from './lib/analytics.js';
import { MAX_SIZE_MB } from './constants/limits.js';

function AppInner() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('login');
  const [authModalSource, setAuthModalSource] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | processing | done | error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [recordedFile, setRecordedFile] = useState(null);
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const [accountStatus, setAccountStatus] = useState(null);
  const [accountStatusLoadState, setAccountStatusLoadState] = useState('not_applicable');
  const [accountStatusRetryCount, setAccountStatusRetryCount] = useState(0);
  const [summaryTrialPending, setSummaryTrialPending] = useState(false);
  const [userChoseFullTrial, setUserChoseFullTrial] = useState(null);
  const [s01File, setS01File] = useState(null);
  const [s01Warning, setS01Warning] = useState('');
  const processingTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const s01ViewTrackedRef = useRef(false);

  useEffect(() => {
    initBilling({
      onPurchaseComplete: () => {
        getAccountStatus().then((s) => {
          if (!s) { setAccountStatusLoadState('error'); return; }
          setAccountStatus(s);
          setAccountStatusLoadState('success');
        }).catch((err) => {
          console.error('[account] post-purchase refresh failed:', err);
          setAccountStatusLoadState('error');
        });
      },
    });
  }, []);

  const planState = planStateFromPlanId(accountStatus?.planId);

  // 認証モーダルを開く。開いた契機はauth_modal_openイベントのsourceとして記録する
  const openAuthModal = (source, mode = null) => {
    if (mode) setAuthModalInitialMode(mode);
    setAuthModalSource(source);
    setShowAuthModal(true);
  };

  // s01_view: S01はidle時の初期画面のため、ページロードごとに1回だけ記録する
  useEffect(() => {
    if (s01ViewTrackedRef.current) return;
    s01ViewTrackedRef.current = true;
    trackEvent('s01_view', { source: 's01' });
  }, []);

  useEffect(() => {
    if (showAuthModal) {
      trackEvent('auth_modal_open', { source: authModalSource, planState });
    }
  }, [showAuthModal]);

  useEffect(() => {
    if (!user) {
      setAccountStatus(null);
      setAccountStatusLoadState('not_applicable');
      return;
    }
    let cancelled = false;
    setAccountStatusLoadState('loading');
    getAccountStatus()
      .then((s) => {
        if (cancelled) return;
        if (!s) { setAccountStatusLoadState('error'); return; }
        setAccountStatus(s);
        setAccountStatusLoadState('success');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[account] getAccountStatus failed:', err);
        setAccountStatusLoadState('error');
      });
    return () => { cancelled = true; };
  }, [user, accountStatusRetryCount]);

  useEffect(() => {
    if (status === 'processing') {
      setProcessingElapsed(0);
      processingTimerRef.current = setInterval(
        () => setProcessingElapsed((s) => s + 1),
        1000,
      );
    } else {
      clearInterval(processingTimerRef.current);
    }
    return () => clearInterval(processingTimerRef.current);
  }, [status]);

  const formatElapsed = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatDuration = (sec) => {
    if (sec < 60) return `${sec}秒`;
    if (sec < 3600) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return s === 0 ? `${m}分` : `${m}分${s}秒`;
    }
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
  };

  const handleTranscribe = async (file) => {
    setError('');

    if (!user) {
      const guestId = getOrCreateGuestId();
      const usedKey = `saidlog_guest_used_${guestId}`;
      if (localStorage.getItem(usedKey)) {
        setError('ゲストの無料体験は1回までです。続けてご利用いただくには無料登録をしてください。');
        openAuthModal('guest_gate', 'signup');
        return;
      }
    }

    setResult(null);

    const durationSeconds = await getAudioDuration(file);

    setStatus('uploading');
    setUploadProgress(0);
    let filePath;
    try {
      filePath = await uploadAudio(file, setUploadProgress);
    } catch (err) {
      setError(t('app.uploadError', { message: err.message }));
      setStatus('error');
      return;
    }

    setStatus('processing');
    try {
      const { transcriptId, ...data } = await requestTranscription(filePath, durationSeconds);
      setResult(data);
      setStatus('done');
      if (!user) {
        const guestId = getOrCreateGuestId();
        const usedKey = `saidlog_guest_used_${guestId}`;
        localStorage.setItem(usedKey, '1');
      }
      if (!transcriptId) {
        saveTranscript({ filename: file.name, result: data });
      }
      if (user) {
        getAccountStatus().then((s) => {
          if (!s) { setAccountStatusLoadState('error'); return; }
          setAccountStatus(s);
          setAccountStatusLoadState('success');
          const eligible = (
            s?.planId === 'ume' &&
            s?.fullSummaryUsed === false &&
            (data.audioDurationSec ?? 0) >= 180
          );
          setSummaryTrialPending(eligible);
          if (!eligible) setUserChoseFullTrial(null);
        }).catch((err) => {
          console.error('[account] post-transcription refresh failed:', err);
          setAccountStatusLoadState('error');
        });
      } else {
        setUserChoseFullTrial(false);
      }
    } catch (err) {
      if (err.message === 'GUEST_TRIAL_USED') {
        setError('ゲストの無料体験は1回までです。続けてご利用いただくには無料登録をしてください。');
        openAuthModal('guest_gate', 'signup');
      } else if (err.message === 'GUEST_TRIAL_TOO_LONG') {
        setError('ゲストの無料体験は15分以内の音声のみ対応しています。無料登録するとより長い音声も文字起こしできます。');
      } else {
        setError(t('app.transcribeError', { message: err.message }));
      }
      setStatus('error');
    }
  };

  const handleRecordedTranscribe = (blob, mimeType) => {
    const file = new File([blob], recordingFileName(mimeType), { type: mimeType });
    setRecordedFile(file);
    handleTranscribe(file);
  };

  const handleSaveRecording = () => {
    downloadBlob(recordedFile, recordedFile.name);
  };

  const handleReset = () => {
    setStatus('idle');
    setResult(null);
    setError('');
    setRecordedFile(null);
    setSummaryTrialPending(false);
    setUserChoseFullTrial(null);
    setS01File(null);
    setS01Warning('');
  };

  const handleS01FileSelect = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!['.mp3', '.mp4', '.wav', '.m4a', '.webm'].includes(ext)) {
      setS01Warning(t('upload.errorFormat'));
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setS01Warning(t('upload.errorSize', { max: MAX_SIZE_MB }));
      return;
    }
    setS01Warning('');
    setS01File(f);
    e.target.value = '';
  };

  const busy = status === 'uploading' || status === 'processing';

  const retryAccountStatus = () => setAccountStatusRetryCount((c) => c + 1);

  const upgradeMode = getUpgradeMode({ user, accountStatus, accountStatusLoadState });

  // S01ミニ説明：未ログイン / ログイン済み無料 / ログイン済みPlus の3状態のみで出し分ける。
  // accountStatus取得中・取得失敗時は「無料プラン」と断定できないため何も表示しない。
  const s01FreeMiniKey = !user
    ? 'app.s01.freeTrialBannerGuest'
    : accountStatusLoadState !== 'success'
      ? null
      : accountStatus?.planId === 'take'
        ? 'app.s01.freeTrialBannerPlus'
        : 'app.s01.freeTrialBannerFree';

  const handleUpgrade = async () => {
    if (upgradeMode === 'purchase') {
      try {
        await purchaseTake();
      } catch (err) {
        console.error('[upgrade] purchaseTake failed:', err);
        alert('購入処理に失敗しました。時間をおいて再度お試しください。');
      }
    } else if (upgradeMode === 'not_logged_in') {
      openAuthModal('plus_cta', 'signup');
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1>SaidLog<span className="header-brand-sub">AI会議メモ</span></h1>
          <div className="header-auth">
            {user ? (
              <>
                <button className="history-pill-btn" onClick={() => setShowHistory(!showHistory)}>{t('app.history')}</button>
                <details className="header-account-details">
                  <summary className="header-account-summary">{user.email}</summary>
                  <div className="header-account-menu">
                    <button onClick={restorePurchases}>購入を復元</button>
                    <button onClick={signOut}>{t('app.logout')}</button>
                  </div>
                </details>
              </>
            ) : (
              <button onClick={() => openAuthModal('header')}>{t('app.login')}</button>
            )}
          </div>
        </div>
      </header>

      {showHistory && user && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(31,41,55,0.64)', zIndex: 900, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px' }} onClick={() => setShowHistory(false)}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '90%', maxWidth: '480px', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid #e5e7eb' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>{t('history.title')}</h2>
              <button onClick={() => setShowHistory(false)}>{t('history.close')}</button>
            </div>
            <HistoryList
              onSelect={(result) => { setResult(result); setStatus('done'); setShowHistory(false); }}
              upgradeMode={upgradeMode}
              onUpgrade={handleUpgrade}
              onRetry={retryAccountStatus}
            />
          </div>
        </div>
      )}

      <main>
        {user && accountStatus && (
          <p className="account-status">
            {accountStatus.planId === 'ume' ? '無料プラン' : accountStatus.planName} | 今月の利用: {formatDuration(accountStatus.usedSeconds)} / {formatDuration(accountStatus.limitSeconds)}
            {accountStatus.remainingSeconds <= 0 && ' | 今月の上限に達しています'}
          </p>
        )}

        {user && accountStatus?.isGracePeriod && (
          <div className="notice" style={{ marginBottom: '1rem' }}>
            <p style={{ margin: 0 }}>{t('account.graceWarning')}</p>
          </div>
        )}

        {/* S01: idle 時のヒーローレイアウト */}
        {status === 'idle' && (
          <div className="s01">
            {/* ヒーロー */}
            <div className="s01-hero">
              <h2 className="s01-heading">{t('app.s01.heading')}</h2>
              <p className="s01-sub">{t('app.s01.sub')}</p>

              {/* 3ステップ */}
              <div className="s01-steps">
                <div className="s01-step">
                  <div className="s01-step-miniature">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                      {[5, 9, 13, 8, 11, 7, 10].map((h, i) => (
                        <div key={i} style={{ width: '3px', height: `${h}px`, background: '#3b82f6', borderRadius: '2px' }} />
                      ))}
                    </div>
                    <div style={{ width: '32px', height: '18px', borderRadius: '4px', background: '#fee2e2', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: '7px', height: '7px', background: '#ef4444', borderRadius: '2px' }} />
                    </div>
                  </div>
                  <span className="s01-step-label">{t('app.s01.step1')}</span>
                </div>
                <span className="s01-step-arrow">→</span>
                <div className="s01-step">
                  <div className="s01-step-miniature" style={{ alignItems: 'flex-start', padding: '8px 10px' }}>
                    <div style={{ height: '5px', background: '#2563eb', borderRadius: '3px', width: '55%', marginBottom: '4px' }} />
                    {[null, null, null].map((_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', marginBottom: '2px' }}>
                        <div style={{ height: '4px', background: '#bfdbfe', borderRadius: '2px', flex: 1 }} />
                        {i === 0 && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke="#047857" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                  <span className="s01-step-label">{t('app.s01.step2')}</span>
                </div>
                <span className="s01-step-arrow">→</span>
                <div className="s01-step">
                  <div className="s01-step-miniature" style={{ alignItems: 'flex-start', padding: '6px 8px' }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>履歴</div>
                    {[
                      { name: '週次MTG', dot: '#047857' },
                      { name: '営業会議', dot: '#1d4ed8' },
                      { name: '1on1', dot: '#9ca3af' },
                    ].map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', marginBottom: '3px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.dot, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.7rem', color: '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      </div>
                    ))}
                  </div>
                  <span className="s01-step-label">{t('app.s01.step3')}</span>
                </div>
              </div>

              {/* 主CTA（Recorder のスタートボタンを .s01-recorder-wrap CSS でスタイル上書き） */}
              <div className="s01-recorder-wrap">
                <Recorder
                  onTranscribe={handleRecordedTranscribe}
                  onRecordStart={() => trackEvent('s01_record_click', { source: 's01', planState })}
                  remainingSeconds={accountStatus?.remainingSeconds ?? null}
                />
              </div>

              {/* 補助CTA */}
              <p className="s01-upload-hint">{t('app.s01.uploadHint')}</p>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".mp3,.mp4,.wav,.m4a,.webm"
                onChange={handleS01FileSelect}
              />
              {s01File ? (
                <div style={{ marginBottom: '8px' }}>
                  <p style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '8px' }}>{s01File.name}</p>
                  <button
                    className="btn primary"
                    onClick={() => { handleTranscribe(s01File); setS01File(null); }}
                  >
                    {t('app.s01.startTranscribe')}
                  </button>
                  {' '}
                  <button
                    className="btn secondary"
                    style={{ marginBottom: 0 }}
                    onClick={() => { setS01File(null); setS01Warning(''); }}
                  >
                    {t('app.s01.changeFile')}
                  </button>
                </div>
              ) : (
                <button
                  className="s01-file-btn"
                  onClick={() => {
                    trackEvent('s01_upload_click', { source: 's01', planState });
                    fileInputRef.current?.click();
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {t('app.s01.uploadCTA')}
                </button>
              )}
              {s01Warning && <p className="warning" style={{ marginTop: '8px' }}>{s01Warning}</p>}

              {/* 安心文 */}
              <p className="s01-trust">{t('app.s01.trust')}</p>

              {/* 無料枠ミニ説明 */}
              <div className="s01-free-mini">
                {s01FreeMiniKey && <p>{t(s01FreeMiniKey)}</p>}
                <a href="#s01-pricing">{t('app.s01.freeTrialLink')}</a>
              </div>

              {/* 詳細折りたたみ */}
              <details style={{ textAlign: 'left', fontSize: '0.8rem', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
                <summary style={{ cursor: 'pointer', color: '#374151', fontWeight: '500' }}>
                  {t('app.s01.detailsSummary')}
                </summary>
                <ul style={{ marginTop: '8px', paddingLeft: '1.4em', lineHeight: '2' }}>
                  <li>{t('app.s01.detailsFormat')}</li>
                  <li>{t('app.s01.detailsSize')}</li>
                  <li>{t('app.s01.detailsTrial')}</li>
                </ul>
              </details>
            </div>

            {/* 価格・無料枠説明エリア */}
            <section id="s01-pricing" className="s01-pricing">
              <h3>無料で試せる範囲と料金</h3>
              <div className="s01-plan-grid">
                <div className="s01-plan">
                  <div className="s01-plan-name">無料プラン</div>
                  {[
                    { text: '0円', yes: true },
                    { text: '月60分まで', yes: true },
                    { text: '履歴は直近3件まで表示', yes: true },
                    { text: '要約プレビュー（3行、閲覧のみ）', yes: true },
                    { text: '詳細要約（フル）', yes: false },
                    { text: 'コピー・エクスポート', yes: false },
                  ].map((f, i) => (
                    <div key={i} className={`s01-plan-feature${f.yes ? '' : ' s01-plan-feature-no'}`}>
                      <span>{f.yes ? '✓' : '✗'}</span>
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
                <div className="s01-plan s01-plan-plus">
                  <div className="s01-plan-name">SaidLog Plus</div>
                  {[
                    { text: '月680円', yes: true },
                    { text: '月10時間', yes: true },
                    { text: '履歴は直近30件まで表示', yes: true },
                    { text: '詳細要約', yes: true },
                    { text: 'コピー・エクスポート', yes: true },
                  ].map((f, i) => (
                    <div key={i} className="s01-plan-feature">
                      <span>✓</span>
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {upgradeMode === 'plus_active' ? (
                  <p style={{ fontSize: '0.875rem', color: '#047857' }}>SaidLog Plus利用中です</p>
                ) : upgradeMode === 'web' ? (
                  <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>SaidLog PlusはAndroidアプリ版でご利用いただけます。</p>
                ) : upgradeMode === 'account_error' ? (
                  <>
                    <p style={{ fontSize: '0.875rem', color: '#b91c1c', marginBottom: '6px' }}>プラン情報を確認できませんでした</p>
                    <button className="btn secondary" onClick={retryAccountStatus} style={{ marginBottom: 0 }}>再試行</button>
                  </>
                ) : upgradeMode === 'loading' ? (
                  <button className="btn primary" disabled style={{ marginBottom: 0 }}>確認中...</button>
                ) : upgradeMode === 'not_logged_in' ? (
                  <button className="btn primary" onClick={handleUpgrade} style={{ marginBottom: 0 }}>無料登録 / ログイン</button>
                ) : (
                  <button className="btn primary" onClick={handleUpgrade} style={{ marginBottom: 0 }}>SaidLog Plusに進む</button>
                )}
              </div>
            </section>

            {/* 無料枠とSaidLog Plusについて */}
            <section className="s01-explanation">
              <h3>無料枠とSaidLog Plusについて</h3>
              <p>音声の文字起こしやAI要約は、録音時間が長いほど処理量が増えます。議事録・文字起こし・AI処理サービスでは一般的にコストがかかる部分ですが、SaidLogでは無料で試せる範囲を用意し、継続して使いやすいように月680円・10時間のPlusプランにしています。</p>
            </section>

            {/* 処理フロー */}
            <section className="s01-flow">
              <h3>録音から会議メモができるまで</h3>
              <div className="s01-flow-steps">
                <div className="s01-flow-step">録音データ</div>
                <span className="s01-flow-arrow">→</span>
                <div className="s01-flow-step">文字起こし</div>
                <span className="s01-flow-arrow">→</span>
                <div className="s01-flow-step">AI要約</div>
                <span className="s01-flow-arrow">→</span>
                <div className="s01-flow-step">会議メモ</div>
              </div>
            </section>
          </div>
        )}

        {status === 'uploading' && (
          <div className="notice processing">
            <div className="spinner" />
            <p>{t('app.uploading', { progress: uploadProgress })}</p>
          </div>
        )}

        {status === 'processing' && (
          <div className="notice processing">
            <div className="processing-left">
              <div className="spinner" />
              <p>{t('app.processing')}<br />{t('app.processingNote')}</p>
            </div>
            <div className="processing-right">
              <span>{t('app.processingLabel')}</span>
              <span className="blink">{t('app.processingTimer', { elapsed: formatElapsed(processingElapsed) })}</span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <>
            <div className="notice error">{error}</div>
            <button className="btn secondary" style={{ marginTop: '12px', marginBottom: 0 }} onClick={handleReset}>← やり直す</button>
          </>
        )}

        {status === 'done' && result && (
          <>
            <p className="done-elapsed">{t('app.done', { elapsed: formatElapsed(processingElapsed) })}</p>
            <button className="btn secondary" onClick={handleReset}>
              ← {t('app.transcribeAnother')}
            </button>
            {recordedFile && (
              <button className="btn secondary" onClick={handleSaveRecording}>
                {t('app.saveRecording')}
              </button>
            )}
            {summaryTrialPending && (
              <div style={{ margin: '1rem 0', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '6px' }}>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>フルAI要約を試しますか？（無料で1回だけ）</p>
                <button
                  className="btn secondary"
                  onClick={() => setUserChoseFullTrial(true)}
                >
                  フルAI要約を試す
                </button>{' '}
                <button
                  className="btn secondary"
                  onClick={() => setUserChoseFullTrial(false)}
                >
                  プレビューだけ見る
                </button>
              </div>
            )}
            <TranscriptView
              result={result}
              userChoseFullTrial={userChoseFullTrial}
              canExport={accountStatus?.canExport ?? false}
              summaryTrialPending={summaryTrialPending}
              onSummaryStarted={() => setSummaryTrialPending(false)}
              upgradeMode={upgradeMode}
              onUpgrade={handleUpgrade}
              onRetry={retryAccountStatus}
              isLoggedIn={!!user}
              onOpenAuthModal={() => openAuthModal('plus_cta', 'signup')}
            />
          </>
        )}
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} user={user} initialMode={authModalInitialMode} />}
      </main>

      <footer className="footer">{t('app.footer')}</footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
