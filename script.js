
(() => {
  const STORE_TASKS = 'pomodoro_tasks_v3';
  const STORE_SETTINGS = 'pomodoro_settings_v3';
  const STORE_SESSIONS = 'pomodoro_sessions_v1';

  const defaultSettings = {
    durationsMin: { pomodoro: 25, short: 5, long: 15 },
    focusSessions: 0,
    notificationsEnabled: false,
    autoStartEnabled: false,
    soundEnabled: true,
    theme: 'dark' // 'light' or 'dark'
  };
  const defaultSessionsState = { activeSessionId: null, sessions: [] };

  const safeParse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  
  // Persistent AudioContext for mobile compatibility
  let audioContext = null;
  let audioContextResumed = false;
  
  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }
  
  function resumeAudioContext() {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          audioContextResumed = true;
        }).catch(err => console.error('AudioContext resume hatası:', err));
      } else {
        audioContextResumed = true;
      }
    } catch (err) {
      console.error('AudioContext hatası:', err);
    }
  }

  function loadSettings() {
    const parsed = safeParse(localStorage.getItem(STORE_SETTINGS), null);
    if (!parsed) return structuredClone(defaultSettings);
    return { ...defaultSettings, ...parsed, durationsMin: { ...defaultSettings.durationsMin, ...(parsed.durationsMin || {}) } };
  }
  function saveSettings() { localStorage.setItem(STORE_SETTINGS, JSON.stringify(settings)); }

  function loadTasks() {
    const parsed = safeParse(localStorage.getItem(STORE_TASKS), []);
    return Array.isArray(parsed) ? parsed : [];
  }
  function saveTasks() { localStorage.setItem(STORE_TASKS, JSON.stringify(tasks)); }

  function loadSessionsState() {
    const parsed = safeParse(localStorage.getItem(STORE_SESSIONS), null);
    if (!parsed || !Array.isArray(parsed.sessions)) return structuredClone(defaultSessionsState);
    return { ...defaultSessionsState, ...parsed };
  }
  function saveSessionsState() { localStorage.setItem(STORE_SESSIONS, JSON.stringify(sessionsState)); }

  function formatTime(sec) {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(mins).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function minutesFromMs(ms) { return Math.round(ms / 60000); }

  function formatDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  function playAlarmSound() {
    if (!settings.soundEnabled) return;
    
    try {
      const ctx = getAudioContext();
      
      // Resume context if suspended (mobile requirement)
      if (ctx.state === 'suspended') {
        ctx.resume().catch(err => console.error('AudioContext resume hatası:', err));
      }
      
      const now = ctx.currentTime;
      
      const playNote = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.08, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      
      [0, 0.2, 0.4, 0.7, 0.9, 1.1].forEach((offset) => {
        playNote(880, now + offset, 0.15);
        playNote(1047, now + offset + 0.02, 0.13);
      });
    } catch (err) {
      console.error('Ses çalınamadı:', err);
    }
  }

  function beep() {
    try {
      const ctx = getAudioContext();
      
      // Resume context if suspended (mobile requirement)
      if (ctx.state === 'suspended') {
        ctx.resume().catch(err => console.error('AudioContext resume hatası:', err));
      }
      
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.03;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => { o.stop(); }, 120);
    } catch {}
  }

  // Theme Management
  const themeBtn = document.getElementById('theme-btn');
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');
  const htmlEl = document.documentElement;

  function applyTheme(theme) {
    if (theme === 'dark') {
      htmlEl.classList.add('dark');
      htmlEl.classList.remove('light');
    } else {
      htmlEl.classList.add('light');
      htmlEl.classList.remove('dark');
    }
    updateThemeButtonUI();
  }

  function toggleTheme() {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(settings.theme);
    saveSettings();
  }

  function updateThemeButtonUI() {
    const isDark = settings.theme === 'dark';
    themeBtn.classList.toggle('text-gray-900', !isDark);
    themeBtn.classList.toggle('dark:text-white', isDark);
    themeBtn.classList.toggle('text-gray-400', isDark);
    themeBtn.classList.toggle('dark:text-white/40', isDark);
    
    if (themeIcon) {
      themeIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
    }
    if (themeText) {
      themeText.textContent = isDark ? 'Koyu' : 'Açık';
    }
  }

  const modal = (() => {
    let busy = false;

    function get() {
      const dlg = document.getElementById('app-dialog');
      if (!dlg) return null;
      return {
        dlg,
        title: document.getElementById('dlg-title'),
        subtitle: document.getElementById('dlg-subtitle'),
        message: document.getElementById('dlg-message'),
        icon: document.getElementById('dlg-icon'),
        ok: document.getElementById('dlg-ok'),
        cancel: document.getElementById('dlg-cancel'),
        x: document.getElementById('dlg-x'),
        input: document.getElementById('dlg-input')
      };
    }

    function base(d, { title='Bilgi', subtitle='Pomodoro Focus', message='', icon='info', showCancel=false, showInput=false, inputValue='' }) {
      d.title && (d.title.textContent = title);
      d.subtitle && (d.subtitle.textContent = subtitle);
      d.message.textContent = message;
      d.icon && (d.icon.textContent = icon);

      if (d.cancel) d.cancel.classList.toggle('hidden', !showCancel);

      if (d.input) {
        d.input.classList.toggle('hidden', !showInput);
        if (showInput) {
          d.input.value = inputValue ?? '';
          queueMicrotask(() => { d.input.focus(); d.input.select(); });
        }
      }
    }

    async function alert(message, opts={}) {
      const d = get();
      if (!d) { console.error('Dialog eksik!'); return true; }

      while (busy) await new Promise(r => setTimeout(r, 30));
      busy = true;

      return new Promise((resolve) => {
        base(d, { message, showCancel:false, showInput:false, ...opts });
        d.ok.textContent = 'Tamam';

        const cleanup = () => {
          d.ok.removeEventListener('click', onOk);
          d.x?.removeEventListener('click', onOk);
          d.dlg.removeEventListener('cancel', onOk);
          busy = false;
        };
        const onOk = () => { cleanup(); d.dlg.close(); resolve(true); };

        d.ok.addEventListener('click', onOk);
        d.x?.addEventListener('click', onOk);
        d.dlg.addEventListener('cancel', onOk);

        if (!d.dlg.open) d.dlg.showModal();
      });
    }

    async function confirm(message, opts={}) {
      const d = get();
      if (!d) { console.error('Dialog eksik!'); return false; }

      while (busy) await new Promise(r => setTimeout(r, 30));
      busy = true;

      return new Promise((resolve) => {
        base(d, { message, showCancel:true, showInput:false, ...opts });
        d.ok.textContent = 'Onayla';
        d.cancel && (d.cancel.textContent = 'Vazgeç');

        const cleanup = () => {
          d.ok.removeEventListener('click', onOk);
          d.cancel?.removeEventListener('click', onCancel);
          d.x?.removeEventListener('click', onCancel);
          d.dlg.removeEventListener('cancel', onCancel);
          busy = false;
        };
        const onOk = () => { cleanup(); d.dlg.close(); resolve(true); };
        const onCancel = () => { cleanup(); d.dlg.close(); resolve(false); };

        d.ok.addEventListener('click', onOk);
        d.cancel?.addEventListener('click', onCancel);
        d.x?.addEventListener('click', onCancel);
        d.dlg.addEventListener('cancel', onCancel);

        if (!d.dlg.open) d.dlg.showModal();
      });
    }

    async function prompt(message, defaultValue='', opts={}) {
      const d = get();
      if (!d || !d.input) { console.error('Dialog/input eksik!'); return null; }

      while (busy) await new Promise(r => setTimeout(r, 30));
      busy = true;

      return new Promise((resolve) => {
        base(d, { message, showCancel:true, showInput:true, inputValue: defaultValue, ...opts });
        d.ok.textContent = 'Kaydet';
        d.cancel && (d.cancel.textContent = 'Vazgeç');

        const cleanup = () => {
          d.ok.removeEventListener('click', onOk);
          d.cancel?.removeEventListener('click', onCancel);
          d.x?.removeEventListener('click', onCancel);
          d.dlg.removeEventListener('cancel', onCancel);
          d.input.removeEventListener('keydown', onEnter);
          busy = false;
        };
        const onOk = () => { const v = d.input.value; cleanup(); d.dlg.close(); resolve(v); };
        const onCancel = () => { cleanup(); d.dlg.close(); resolve(null); };
        const onEnter = (e) => { if (e.key === 'Enter') onOk(); };

        d.ok.addEventListener('click', onOk);
        d.cancel?.addEventListener('click', onCancel);
        d.x?.addEventListener('click', onCancel);
        d.dlg.addEventListener('cancel', onCancel);
        d.input.addEventListener('keydown', onEnter);

        if (!d.dlg.open) d.dlg.showModal();
      });
    }

    return { alert, confirm, prompt };
  })();

  let settings = loadSettings();
  let tasks = loadTasks();
  let sessionsState = loadSessionsState();

  const modes = {
    pomodoro: { label: 'Odaklanma', color: '#ee652b' },
    short: { label: 'Mola', color: '#38bdf8' },
    long: { label: 'Uzun Mola', color: '#818cf8' }
  };

  let currentMode = 'pomodoro';
  let timeLeftSec = (settings.durationsMin[currentMode] || 25) * 60;
  let timerId = null;
  let endAtMs = null;
  let pausedAtMs = null;

  const RING = 283;

  const timerDisplay = document.getElementById('timer-display');
  const timerLabel = document.getElementById('timer-label');
  const sessionInfo = document.getElementById('session-info');
  const progressBar = document.getElementById('progress-bar');
  const startBtn = document.getElementById('start-btn');
  const skipBtn = document.getElementById('skip-btn');
  const modeBtns = document.querySelectorAll('.mode-btn');
  const resetBtn = document.getElementById('reset-stats');
  const enableNotifBtn = document.getElementById('enable-notifications');
  const notifText = document.getElementById('notif-text');
  const autoStartBtn = document.getElementById('auto-start-btn');
  const autoStartText = document.getElementById('auto-start-text');
  const soundBtn = document.getElementById('sound-btn');
  const soundIcon = document.getElementById('sound-icon');
  const soundText = document.getElementById('sound-text');
  const pipBtn = document.getElementById('pip-btn');
  const pipText = document.getElementById('pip-text');

  const notesModal = document.getElementById('notes-modal');
  const navNotes = document.getElementById('nav-notes');
  const navHistory = document.getElementById('nav-history');
  const navSettings = document.getElementById('nav-settings');
  const notesClose = document.getElementById('notes-close');
  const taskListModal = document.getElementById('task-list-modal');
  const taskFormModal = document.getElementById('task-form-modal');
  const taskInputModal = document.getElementById('task-input-modal');
  const historyListModal = document.getElementById('history-list-modal');
  const sessionSelectModal = document.getElementById('session-select-modal');
  const sessionTotalModal = document.getElementById('session-total-modal');
  const newSessionBtnModal = document.getElementById('new-session-btn-modal');
  const deleteSessionBtnModal = document.getElementById('delete-session-btn-modal');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.id.replace('tab-', 'content-');
      
      tabBtns.forEach(b => {
        b.classList.remove('text-gray-900', 'dark:text-white', 'border-primary');
        b.classList.add('text-gray-500', 'dark:text-white/40', 'border-transparent');
      });
      
      btn.classList.remove('text-gray-500', 'dark:text-white/40', 'border-transparent');
      btn.classList.add('text-gray-900', 'dark:text-white', 'border-primary');
      
      tabContents.forEach(c => c.classList.add('hidden'));
      document.getElementById(target)?.classList.remove('hidden');
    });
  });

  function ensureDefaultSession() {
    if (sessionsState.sessions.length > 0) {
      if (!sessionsState.activeSessionId) sessionsState.activeSessionId = sessionsState.sessions[0].id;
      return;
    }
    const id = uid();
    sessionsState.sessions.push({ id, name: 'Genel', createdAt: Date.now(), records: [] });
    sessionsState.activeSessionId = id;
    saveSessionsState();
  }

  function getActiveSession() {
    return sessionsState.sessions.find(s => s.id === sessionsState.activeSessionId) || null;
  }

  function setActiveSession(id) {
    sessionsState.activeSessionId = id;
    saveSessionsState();
    renderSessionsUI();
    renderHistoryUI();
  }

  function addSession(name) {
    const id = uid();
    sessionsState.sessions.unshift({ id, name, createdAt: Date.now(), records: [] });
    sessionsState.activeSessionId = id;
    saveSessionsState();
    renderSessionsUI();
    renderHistoryUI();
  }

  async function deleteActiveSession() {
    const s = getActiveSession();
    if (!s) return;
    const ok = await modal.confirm(`"${s.name}" session silinsin mi?`, { title:'Session Sil', icon:'delete' });
    if (!ok) return;

    sessionsState.sessions = sessionsState.sessions.filter(x => x.id !== s.id);
    sessionsState.activeSessionId = sessionsState.sessions[0]?.id || null;
    saveSessionsState();
    ensureDefaultSession();
    renderSessionsUI();
    renderHistoryUI();
  }

  function calcSessionTotalMs(session) {
    return (session.records || []).reduce((sum, r) => sum + (r.durationMs || 0), 0);
  }

  function renderSessionsUI() {
    if (!sessionSelectModal) return;
    sessionSelectModal.innerHTML = '';
    sessionsState.sessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === sessionsState.activeSessionId) opt.selected = true;
      sessionSelectModal.appendChild(opt);
    });

    const active = getActiveSession();
    const totalMs = active ? calcSessionTotalMs(active) : 0;
    sessionTotalModal.textContent = `${minutesFromMs(totalMs)} dk`;
  }

  function renderHistoryUI() {
    if (!historyListModal) return;
    historyListModal.innerHTML = '';

    const active = getActiveSession();
    if (!active) return;

    const records = [...(active.records || [])].sort((a,b) => b.endAt - a.endAt).slice(0, 50);
    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-xs sm:text-sm text-gray-500 dark:text-white/40 text-center py-8';
      empty.textContent = 'Henüz kayıt yok.';
      historyListModal.appendChild(empty);
      return;
    }

    records.forEach(r => {
      const row = document.createElement('div');
      row.className = 'p-3 sm:p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 flex items-center justify-between gap-3';

      const left = document.createElement('div');
      left.className = 'flex flex-col flex-1';

      const t1 = document.createElement('div');
      t1.className = 'text-xs sm:text-sm text-gray-900 dark:text-white font-semibold mb-1';
      t1.textContent = `${minutesFromMs(r.durationMs)} dakika odaklanma`;

      const t2 = document.createElement('div');
      t2.className = 'text-[10px] sm:text-xs text-gray-500 dark:text-white/40';
      t2.textContent = `${formatDateTime(r.startAt)} → ${formatDateTime(r.endAt)}`;

      left.append(t1, t2);

      const badge = document.createElement('div');
      badge.className = 'text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary font-semibold';
      badge.textContent = r.mode || 'pomodoro';

      row.append(left, badge);
      historyListModal.appendChild(row);
    });
  }

  function recordCompletedPomodoro(durationSec) {
    const active = getActiveSession();
    if (!active) return;

    const endAt = Date.now();
    const record = { id: uid(), mode: 'pomodoro', startAt: endAt - durationSec * 1000, endAt, durationMs: durationSec * 1000 };

    if (!Array.isArray(active.records)) active.records = [];
    active.records.push(record);

    saveSessionsState();
    renderSessionsUI();
    renderHistoryUI();
  }

  async function enableNotificationsFlow() {
    resumeAudioContext(); // Resume on user interaction
    if (!('Notification' in window)) {
      await modal.alert('Tarayıcı bildirimleri desteklemiyor.', { title:'Bildirim', icon:'notifications' });
      return;
    }
    const permission = await Notification.requestPermission();
    settings.notificationsEnabled = (permission === 'granted');
    saveSettings();
    updateNotifButtonUI();
    if (settings.notificationsEnabled) {
      try { new Notification('Bildirimler aktif', { body: 'Pomodoro bitince bildirim alacaksın.' }); } catch {}
    }
  }

  function updateNotifButtonUI() {
    const isEnabled = settings.notificationsEnabled;
    enableNotifBtn.classList.toggle('text-gray-900', isEnabled && settings.theme === 'light');
    enableNotifBtn.classList.toggle('dark:text-white', isEnabled && settings.theme === 'dark');
    enableNotifBtn.classList.toggle('text-gray-400', !isEnabled && settings.theme === 'light');
    enableNotifBtn.classList.toggle('dark:text-white/40', !isEnabled && settings.theme === 'dark');
    if (notifText) {
      notifText.textContent = isEnabled ? 'Açık' : 'Bildirimler';
    }
  }

  function notify(title, body) {
    if (!settings.notificationsEnabled) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try { 
      new Notification(title, { 
        body,
        tag: 'pomodoro-notification',
        requireInteraction: true,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%23ee652b"/><text x="50" y="60" font-size="60" font-weight="bold" text-anchor="middle" fill="white">⏲</text></svg>'
      }); 
    } catch {}
  }

  function toggleSound() {
    resumeAudioContext(); // Resume on user interaction
    settings.soundEnabled = !settings.soundEnabled;
    saveSettings();
    updateSoundButtonUI();
    
    if (settings.soundEnabled) {
      playAlarmSound();
    }
  }

  function updateSoundButtonUI() {
    const isEnabled = settings.soundEnabled;
    soundBtn.classList.toggle('text-gray-900', isEnabled && settings.theme === 'light');
    soundBtn.classList.toggle('dark:text-white', isEnabled && settings.theme === 'dark');
    soundBtn.classList.toggle('text-gray-400', !isEnabled && settings.theme === 'light');
    soundBtn.classList.toggle('dark:text-white/40', !isEnabled && settings.theme === 'dark');
    
    if (soundIcon) {
      soundIcon.textContent = isEnabled ? 'volume_up' : 'volume_off';
    }
    if (soundText) {
      soundText.textContent = isEnabled ? 'Ses Açık' : 'Ses Kapalı';
    }
  }

  function toggleAutoStart() {
    settings.autoStartEnabled = !settings.autoStartEnabled;
    saveSettings();
    updateAutoStartButtonUI();
  }

  function updateAutoStartButtonUI() {
    const isEnabled = settings.autoStartEnabled;
    autoStartBtn.classList.toggle('text-gray-900', isEnabled && settings.theme === 'light');
    autoStartBtn.classList.toggle('dark:text-white', isEnabled && settings.theme === 'dark');
    autoStartBtn.classList.toggle('text-gray-400', !isEnabled && settings.theme === 'light');
    autoStartBtn.classList.toggle('dark:text-white/40', !isEnabled && settings.theme === 'dark');
    if (autoStartText) autoStartText.textContent = isEnabled ? 'Açık' : 'Otomatik';
  }

  function modeTotalSec(mode) { return (settings.durationsMin[mode] || 1) * 60; }

  function updateStartButton() {
    const iconEl = document.getElementById('start-icon');
    const textEl = document.getElementById('start-text');
    if (!iconEl || !textEl) return;

    if (timerId) {
      iconEl.textContent = 'pause';
      textEl.textContent = 'DURAKLAT';
    } else {
      iconEl.textContent = 'play_arrow';
      textEl.textContent = pausedAtMs ? 'DEVAM' : 'BAŞLAT';
    }
  }

  function updateDisplay() {
    timerDisplay.textContent = formatTime(timeLeftSec);
    timerLabel.textContent = modes[currentMode].label;
    sessionInfo.textContent = `Odak: ${settings.focusSessions}`;
    document.title = `${formatTime(timeLeftSec)} - Pomodoro`;
    sendTimerStateToPip();
  }

  function updateProgress() {
    const total = modeTotalSec(currentMode);
    const elapsed = total - timeLeftSec;
    const offset = RING - (RING * elapsed) / total;
    progressBar.style.strokeDashoffset = String(Math.max(0, Math.min(RING, offset)));
    progressBar.style.stroke = modes[currentMode].color;
  }

  function setActiveTab(mode) {
    modeBtns.forEach(btn => {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('bg-primary', isActive);
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('text-gray-600', !isActive && settings.theme === 'light');
      btn.classList.toggle('dark:text-white/60', !isActive && settings.theme === 'dark');
    });
  }

  function initTimer() {
    timeLeftSec = modeTotalSec(currentMode);
    endAtMs = null;
    pausedAtMs = null;
    updateStartButton();
    updateDisplay();
    updateProgress();
  }

  function startTimer() {
    if (timerId) return;

    const now = Date.now();
    if (!endAtMs) endAtMs = now + timeLeftSec * 1000;
    if (pausedAtMs) { endAtMs += (now - pausedAtMs); pausedAtMs = null; }

    timerId = setInterval(() => {
      const remainingMs = endAtMs - Date.now();
      timeLeftSec = Math.max(0, Math.ceil(remainingMs / 1000));
      updateDisplay();
      updateProgress();
      if (timeLeftSec <= 0) finishTimer();
    }, 250);

    updateStartButton();
    sendTimerStateToPip();
  }

  function pauseTimer() {
    if (!timerId) return;
    clearInterval(timerId);
    timerId = null;
    pausedAtMs = Date.now();
    updateStartButton();
    sendTimerStateToPip();
  }

  function stopTimerUIReset() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    endAtMs = null;
    pausedAtMs = null;
    updateStartButton();
    sendTimerStateToPip();
  }

  function toggleTimer() {
    if (timerId) pauseTimer();
    else startTimer();
  }

  async function finishTimer() {
    stopTimerUIReset();
    
    playAlarmSound();
    
    notify('Süre bitti', `${modes[currentMode].label} tamamlandı.`);

    if (currentMode === 'pomodoro') {
      recordCompletedPomodoro(modeTotalSec('pomodoro'));
      settings.focusSessions += 1;
      saveSettings();

      if (!settings.autoStartEnabled) {
        await modal.alert('Pomodoro tamamlandı!', { title:'Bitti', icon:'timer' });
      }

      const next = (settings.focusSessions % 4 === 0) ? 'long' : 'short';
      switchMode(next, true);

      if (settings.autoStartEnabled) startTimer();
    } else {
      if (!settings.autoStartEnabled) {
        await modal.alert('Mola bitti!', { title:'Bitti', icon:'coffee' });
      }

      switchMode('pomodoro', true);
      if (settings.autoStartEnabled) startTimer();
    }
  }

  function switchMode(mode, silent=false) {
    currentMode = mode;
    setActiveTab(mode);
    stopTimerUIReset();
    initTimer();
    if (!silent) beep();
  }

  function renderTasks() {
    taskListModal.innerHTML = '';
    
    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-xs sm:text-sm text-gray-500 dark:text-white/40 text-center py-8';
      empty.textContent = 'Henüz görev yok. Yukarıdan ekleyebilirsin!';
      taskListModal.appendChild(empty);
      return;
    }

    tasks.forEach((task, index) => {
      const card = document.createElement('div');
      card.className = `flex flex-col gap-2.5 sm:gap-3 p-3 sm:p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 group transition-all ${task.completed ? 'task-done' : ''}`;

      const row = document.createElement('div');
      row.className = 'flex items-center gap-2.5 sm:gap-3';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = `size-5 sm:size-6 rounded-full border-2 ${task.completed ? 'bg-primary border-primary' : 'border-gray-300 dark:border-white/20'} flex items-center justify-center shrink-0`;
      toggleBtn.type = 'button';
      toggleBtn.addEventListener('click', () => {
        tasks[index].completed = !tasks[index].completed;
        saveTasks();
        renderTasks();
      });

      const checkIcon = document.createElement('span');
      checkIcon.className = `material-symbols-outlined text-[14px] sm:text-[16px] text-white ${task.completed ? '' : 'hidden'}`;
      checkIcon.textContent = 'check';
      toggleBtn.appendChild(checkIcon);

      const text = document.createElement('span');
      text.className = `text-xs sm:text-sm font-medium flex-1 text-gray-900 dark:text-white ${task.completed ? 'line-through' : ''}`;
      text.textContent = task.text ?? '';

      const delBtn = document.createElement('button');
      delBtn.className = 'text-gray-300 dark:text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1';
      delBtn.type = 'button';
      delBtn.addEventListener('click', async () => {
        const ok = await modal.confirm('Görev silinsin mi?', { title:'Sil', icon:'delete' });
        if (!ok) return;
        tasks.splice(index, 1);
        saveTasks();
        renderTasks();
      });

      const delIcon = document.createElement('span');
      delIcon.className = 'material-symbols-outlined text-[16px] sm:text-[18px]';
      delIcon.textContent = 'delete';
      delBtn.appendChild(delIcon);

      row.append(toggleBtn, text, delBtn);

      const ta = document.createElement('textarea');
      ta.placeholder = 'Not ekle...';
      ta.className = 'w-full bg-gray-100 dark:bg-black/20 border-none rounded-lg p-2.5 sm:p-3 text-[10px] sm:text-xs text-gray-600 dark:text-white/60 focus:text-gray-900 dark:focus:text-white focus:ring-1 focus:ring-primary/30 resize-none no-scrollbar min-h-[50px] sm:min-h-[60px]';
      ta.value = task.note ?? '';
      ta.addEventListener('change', (e) => {
        tasks[index].note = e.target.value;
        saveTasks();
      });

      card.append(row, ta);
      taskListModal.appendChild(card);
    });
  }

  let pipWin = null;

  function isDocumentPipSupported() {
    return !!window.documentPictureInPicture?.requestWindow;
  }

  function sendTimerStateToPip() {
    if (!pipWin || pipWin.closed) return;
    pipWin.postMessage({
      type: 'TIMER_STATE',
      payload: {
        label: modes[currentMode].label,
        color: modes[currentMode].color,
        timeLeftSec,
        running: !!timerId
      }
    }, '*');
  }

  function updatePipButtonUI() {
    const isOpen = pipWin && !pipWin.closed;
    pipBtn.classList.toggle('text-gray-900', isOpen && settings.theme === 'light');
    pipBtn.classList.toggle('dark:text-white', isOpen && settings.theme === 'dark');
    pipBtn.classList.toggle('text-gray-400', !isOpen && settings.theme === 'light');
    pipBtn.classList.toggle('dark:text-white/40', !isOpen && settings.theme === 'dark');
    if (pipText) {
      pipText.textContent = isOpen ? 'Açık' : 'PiP';
    }
  }

  async function openTimerPip() {
    if (!isDocumentPipSupported()) {
      await modal.alert('PiP desteklenmiyor (Chrome/Edge + HTTPS gerekir).', { title:'PiP', icon:'warning' });
      return;
    }

    try {
      if (pipWin && !pipWin.closed) {
        pipWin.close();
        pipWin = null;
        updatePipButtonUI();
        return;
      }

      pipWin = await window.documentPictureInPicture.requestWindow({
        width: 340,
        height: 240,
        disallowReturnToOpener: true
      });

      pipWin.document.head.innerHTML = `
        <meta charset="utf-8" />
        <title>⏱ Pomodoro</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          :root { color-scheme: dark; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            background: #0f0b09;
            color: #fff;
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .card { 
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 16px;
            gap: 12px;
          }
          .top { 
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .badge { 
            font-size: 11px;
            opacity: 0.6;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            font-weight: 600;
          }
          .time { 
            font-size: 64px;
            font-weight: 900;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.03em;
            line-height: 1;
            text-align: center;
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .btnrow { 
            display: flex;
            gap: 8px;
          }
          button { 
            flex: 1;
            height: 48px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(0,0,0,0.3);
            color: #fff;
            font-weight: 800;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
          }
          button:hover { 
            background: rgba(0,0,0,0.5);
            border-color: rgba(255,255,255,0.2);
          }
          button:active { 
            transform: scale(0.97);
          }
          button.primary { 
            border: none;
          }
        </style>
      `;

      pipWin.document.body.innerHTML = `
        <div class="card">
          <div class="top">
            <div class="badge" id="pip-label">Odaklanma</div>
            <div class="badge" id="pip-status">DURDU</div>
          </div>
          <div class="time" id="pip-time">25:00</div>
          <div class="btnrow">
            <button id="pip-toggle" class="primary">BAŞLAT</button>
            <button id="pip-close">KAPAT</button>
          </div>
        </div>
      `;

      pipWin.document.getElementById('pip-toggle').addEventListener('click', () => {
        toggleTimer();
        sendTimerStateToPip();
      });

      pipWin.document.getElementById('pip-close').addEventListener('click', () => pipWin.close());

      pipWin.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'TIMER_STATE') return;
        const { label, color, timeLeftSec, running } = e.data.payload;

        const labelEl = pipWin.document.getElementById('pip-label');
        const timeEl = pipWin.document.getElementById('pip-time');
        const statusEl = pipWin.document.getElementById('pip-status');
        const toggleBtn = pipWin.document.getElementById('pip-toggle');

        if (labelEl) labelEl.textContent = label;
        if (timeEl) timeEl.textContent = formatTime(timeLeftSec);
        if (statusEl) statusEl.textContent = running ? 'ÇALIŞIYOR' : 'DURDU';
        if (toggleBtn) {
          toggleBtn.textContent = running ? 'DURAKLAT' : 'BAŞLAT';
          toggleBtn.style.background = color;
          toggleBtn.style.color = '#fff';
        }
      });

      pipWin.addEventListener('pagehide', () => { 
        pipWin = null; 
        updatePipButtonUI();
      });
      
      updatePipButtonUI();
      sendTimerStateToPip();
    } catch (err) {
      pipWin = null;
      updatePipButtonUI();
      await modal.alert(`PiP açılamadı: ${err?.name || 'Hata'}`, { title:'PiP', icon:'error' });
    }
  }

  startBtn.addEventListener('click', toggleTimer);

  skipBtn.addEventListener('click', async () => {
    const ok = await modal.confirm('Geçmek istiyor musun?', { title:'Onay', icon:'skip_next' });
    if (!ok) return;
    if (currentMode === 'pomodoro') switchMode('short');
    else switchMode('pomodoro');
  });

  modeBtns.forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

  timerDisplay.addEventListener('click', async () => {
    if (timerId) return;
    const currentMin = settings.durationsMin[currentMode];
    const input = await modal.prompt('Yeni süre (dakika):', String(currentMin), { title:'Süre', icon:'edit' });
    if (input === null) return;

    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0 || n > 180) {
      await modal.alert('Geçerli bir değer gir (1-180).', { title:'Hata', icon:'error' });
      return;
    }
    settings.durationsMin[currentMode] = Math.round(n);
    saveSettings();
    initTimer();
  });

  taskFormModal.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = taskInputModal.value.trim();
    if (!text) return;
    tasks.push({ text, completed: false, note: '' });
    taskInputModal.value = '';
    saveTasks();
    renderTasks();
  });

  newSessionBtnModal?.addEventListener('click', async () => {
    const name = await modal.prompt('Session adı:', '', { title:'Yeni', icon:'folder' });
    if (!name) return;
    addSession(name.trim());
  });

  sessionSelectModal?.addEventListener('change', (e) => setActiveSession(e.target.value));
  deleteSessionBtnModal?.addEventListener('click', deleteActiveSession);

  resetBtn.addEventListener('click', async () => {
    const ok = await modal.confirm('Tüm veriler silinecek. Emin misin?', { title:'Sıfırla', icon:'restart_alt' });
    if (!ok) return;

    localStorage.removeItem(STORE_TASKS);
    localStorage.removeItem(STORE_SETTINGS);
    localStorage.removeItem(STORE_SESSIONS);

    tasks = [];
    settings = structuredClone(defaultSettings);
    sessionsState = loadSessionsState();

    currentMode = 'pomodoro';
    setActiveTab(currentMode);
    stopTimerUIReset();
    initTimer();

    ensureDefaultSession();
    renderSessionsUI();
    renderHistoryUI();
    renderTasks();
    applyTheme(settings.theme);
    updateNotifButtonUI();
    updateAutoStartButtonUI();
    updateSoundButtonUI();
    updatePipButtonUI();

    await modal.alert('Tüm veriler silindi.', { title:'Tamam', icon:'check_circle' });
  });

  enableNotifBtn.addEventListener('click', enableNotificationsFlow);
  autoStartBtn.addEventListener('click', toggleAutoStart);
  soundBtn.addEventListener('click', toggleSound);
  themeBtn.addEventListener('click', toggleTheme);
  pipBtn?.addEventListener('click', openTimerPip);

  navNotes.addEventListener('click', () => {
    renderTasks();
    renderSessionsUI();
    renderHistoryUI();
    notesModal.showModal();
  });

  navHistory.addEventListener('click', () => {
    renderHistoryUI();
    notesModal.showModal();
    document.getElementById('tab-history').click();
  });

  navSettings.addEventListener('click', () => {
    renderSessionsUI();
    notesModal.showModal();
    document.getElementById('tab-sessions').click();
  });

  notesClose.addEventListener('click', () => notesModal.close());

  document.addEventListener('visibilitychange', () => {
    if (!timerId || !endAtMs) return;
    const remainingMs = endAtMs - Date.now();
    timeLeftSec = Math.max(0, Math.ceil(remainingMs / 1000));
    updateDisplay();
    updateProgress();
  });

  function initUI() {
    applyTheme(settings.theme);
    ensureDefaultSession();
    renderSessionsUI();
    renderHistoryUI();
    setActiveTab(currentMode);
    initTimer();
    renderTasks();
    updateNotifButtonUI();
    updateAutoStartButtonUI();
    updateSoundButtonUI();
    updatePipButtonUI();
    
    // Resume AudioContext on first user interaction (mobile requirement)
    const resumeOnInteraction = () => {
      resumeAudioContext();
      document.removeEventListener('click', resumeOnInteraction);
      document.removeEventListener('touchstart', resumeOnInteraction);
      document.removeEventListener('keydown', resumeOnInteraction);
    };
    document.addEventListener('click', resumeOnInteraction, { once: true });
    document.addEventListener('touchstart', resumeOnInteraction, { once: true });
    document.addEventListener('keydown', resumeOnInteraction, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
  else initUI();
})();
