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
import { MAX_SIZE_MB } from './constants/limits.js';

function AppInner() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('login');
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

  useEffect(() => { initBilling(); }, []);

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
        setAuthModalInitialMode('signup');
        setShowAuthModal(true);
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
        setAuthModalInitialMode('signup');
        setShowAuthModal(true);
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

  const handleUpgrade = async () => {
    if (upgradeMode === 'purchase') {
      try {
        await purchaseTake();
        getAccountStatus().then((s) => {
          if (!s) { setAccountStatusLoadState('error'); return; }
          setAccountStatus(s);
          setAccountStatusLoadState('success');
        }).catch((err) => {
          console.error('[account] post-purchase refresh failed:', err);
          setAccountStatusLoadState('error');
        });
      } catch (err) {
        console.error('[upgrade] purchaseTake failed:', err);
        alert('購入処理に失敗しました。時間をおいて再度お試しください。');
      }
    } else if (upgradeMode === 'not_logged_in') {
      setAuthModalInitialMode('signup');
      setShowAuthModal(true);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1 style={{ fontSize: '1rem', fontWeight: '600', letterSpacing: '0.05em' }}>SaidLog</h1>
        <div className="header-auth">
          {user ? (
            <>
              <button onClick={() => setShowHistory(!showHistory)}>{t('app.history')}</button>
              <button onClick={restorePurchases}>購入を復元</button>
              <button onClick={() => setShowAuthModal(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}>{user.email}</button>
              <button onClick={signOut}>{t('app.logout')}</button>
            </>
          ) : (
            <button onClick={() => setShowAuthModal(true)}>{t('app.login')}</button>
          )}
        </div>
        <p className="tagline">{t('app.tagline')}</p>
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

        {/* S01: idle 時のヒーローレイアウト */}
        {status === 'idle' && (
          <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#111827', margin: '0 0 8px', lineHeight: '1.4' }}>
              {t('app.s01.heading')}
            </h2>
            <p style={{ color: '#4b5563', marginBottom: '24px', fontSize: '0.95rem' }}>
              {t('app.s01.sub')}
            </p>

            <Recorder onTranscribe={handleRecordedTranscribe} />

            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '20px 0 8px' }}>
              {t('app.s01.uploadHint')}
            </p>

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
                className="btn secondary"
                style={{ marginBottom: 0 }}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('app.s01.uploadCTA')}
              </button>
            )}

            {s01Warning && <p className="warning" style={{ marginTop: '8px' }}>{s01Warning}</p>}

            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '16px 0' }}>
              {t('app.s01.trust')}
            </p>

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
              onOpenAuthModal={() => { setAuthModalInitialMode('signup'); setShowAuthModal(true); }}
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
