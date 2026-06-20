import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import UploadForm from './components/UploadForm.jsx';
import Recorder from './components/Recorder.jsx';
import TranscriptView from './components/TranscriptView.jsx';
import { uploadAudio, requestTranscription, getAudioDuration, getAccountStatus } from './api.js';
import { recordingFileName, downloadBlob } from './lib/recorder.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { AuthModal } from './components/AuthModal.jsx';
import { saveTranscript } from './lib/history.js';
import { HistoryList } from './components/HistoryList.jsx';

function AppInner() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | processing | done | error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [recordedFile, setRecordedFile] = useState(null);
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const [accountStatus, setAccountStatus] = useState(null);
  const [summaryTrialPending, setSummaryTrialPending] = useState(false);
  const [userChoseFullTrial, setUserChoseFullTrial] = useState(null);
  const processingTimerRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setAccountStatus(null);
      return;
    }
    getAccountStatus().then(setAccountStatus).catch(() => setAccountStatus(null));
  }, [user]);

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
      if (!transcriptId) {
        saveTranscript({ filename: file.name, result: data });
      }
      if (user) {
        getAccountStatus().then((s) => {
          setAccountStatus(s);
          const eligible = (
            s?.planId === 'ume' &&
            s?.fullSummaryUsed === false &&
            (data.audioDurationSec ?? 0) >= 300
          );
          setSummaryTrialPending(eligible);
          if (!eligible) setUserChoseFullTrial(null);
        }).catch(() => {});
      } else {
        setUserChoseFullTrial(false);
      }
    } catch (err) {
      setError(t('app.transcribeError', { message: err.message }));
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
  };

  const busy = status === 'uploading' || status === 'processing';

  return (
    <div className="app">
      <header className="header">
        <h1>SaidLog</h1>
        <div className="header-auth">
          {user ? (
            <>
              <button onClick={() => setShowHistory(!showHistory)}>{t('app.history')}</button>
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
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:900,display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:'80px'}} onClick={() => setShowHistory(false)}>
          <div style={{background:'#fff',borderRadius:'8px',padding:'1.5rem',width:'90%',maxWidth:'480px',maxHeight:'70vh',overflowY:'auto'}} onClick={(e) => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
              <h2 style={{margin:0}}>{t('history.title')}</h2>
              <button onClick={() => setShowHistory(false)}>{t('history.close')}</button>
            </div>
            <HistoryList
              onSelect={(result) => { setResult(result); setStatus('done'); setShowHistory(false); }}
              planId={accountStatus?.planId}
            />
          </div>
        </div>
      )}
      <main>
        {user && accountStatus && (
          <p className="account-status">
            {accountStatus.planName}プラン | 今月の利用: {formatDuration(accountStatus.usedSeconds)} / {formatDuration(accountStatus.limitSeconds)}
            {accountStatus.remainingSeconds <= 0 && ' | 今月の上限に達しています'}
          </p>
        )}

        {status !== 'done' && <UploadForm onSubmit={handleTranscribe} processing={busy} />}

        {status !== 'done' && !busy && <Recorder onTranscribe={handleRecordedTranscribe} />}

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
              <span className="blink">{t('app.processingLabel')}</span>
              <span>{t('app.processingTimer', { elapsed: formatElapsed(processingElapsed) })}</span>
            </div>
          </div>
        )}

        {status === 'error' && <div className="notice error">{error}</div>}

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
              canExport={accountStatus?.canExport ?? true}
              summaryTrialPending={summaryTrialPending}
              onSummaryStarted={() => setSummaryTrialPending(false)}
            />
          </>
        )}
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} user={user} />}
      </main>

      <section className="usage-notes">
        <p>{t('app.usageNotes.title')}</p>
        <ul>
          <li>{t('app.usageNotes.speakers')}</li>
          <li>{t('app.usageNotes.quiet')}</li>
          <li>{t('app.usageNotes.editName')}</li>
          <li>{t('app.usageNotes.apiCost')}</li>
          <li>{t('app.usageNotes.sizeLimit')}</li>
          <li>{t('app.usageNotes.keepScreen')}</li>
          <li>{t('app.usageNotes.noServer')}</li>
        </ul>
      </section>

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
