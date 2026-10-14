const api = window.gideon;
const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll('[data-screen]')];
const controls = [...document.querySelectorAll('button')];
let currentStatus = null;
let busy = false;
let lastPhase = 'loading';
let unsubscribe = null;

function clearKey(fieldId, toggleId) {
  const field = $(fieldId);
  field.value = '';
  field.type = 'password';
  $(toggleId).textContent = 'Göster';
  $(toggleId).setAttribute('aria-pressed', 'false');
  $(toggleId).setAttribute('aria-label', fieldId === 'setup-key' ? 'Anahtarı göster' : 'Yeni anahtarı göster');
}

function notice(message = '', isError = false) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
  $('notice').classList.toggle('is-error', isError);
}

function fieldError(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function updateControls() {
  for (const button of controls) button.disabled = busy;
  if (!currentStatus) return;
  const storageAvailable = currentStatus.keyStorageAvailable === true;
  $('save-start-button').disabled = busy || !storageAvailable;
  $('update-key-button').disabled = busy || !storageAvailable;
  $('forget-key-button').disabled = busy || !currentStatus.hasKey;
  $('stop-button').disabled = busy || !currentStatus.gatewayReady;
  $('open-panel-button').disabled = busy || !currentStatus.gatewayReady;
  $('setup-key').disabled = busy || !storageAvailable;
  $('settings-key').disabled = busy || !storageAvailable;
}

function applyStatus(status) {
  if (!status || typeof status !== 'object') return;
  currentStatus = status;
  const phase = ['welcome', 'starting', 'ready', 'error'].includes(status.phase) ? status.phase : 'error';
  for (const screen of screens) screen.classList.toggle('is-visible', screen.dataset.screen === phase);

  const labels = { welcome: 'Bağlantı bekleniyor', starting: 'GIDEON hazırlanıyor', ready: 'Sohbet bağlantısı hazır', error: 'Bağlantı kurulamadı' };
  $('status-label').textContent = labels[phase];
  $('status-dot').className = `status-dot ${phase}`;
  $('status-detail').textContent = phase === 'ready' ? 'Sohbeti açabilirsiniz' : phase === 'starting' ? 'Lütfen biraz bekleyin' : 'GIDEON masaüstü';
  $('starting-message').textContent = status.message || 'Sohbet bağlantısı başlatılıyor.';
  $('error-message').textContent = status.message || 'GIDEON şu anda açılamıyor. Bağlantınızı kontrol edip yeniden deneyebilirsiniz.';
  $('setup-card').hidden = !!status.hasKey;
  $('saved-connection').hidden = !status.hasKey;
  $('welcome-start-button').hidden = !status.hasKey;
  $('settings-key-status').textContent = status.hasKey ? 'Bağlantı anahtarınız kullanıma hazır.' : 'Henüz bir anahtar kayıtlı değil.';
  $('voice-note').textContent = status.liveVerified === true
    ? 'Sesli kullanım için sohbet penceresinde mikrofon izni verin.'
    : 'Sesli kullanım için sohbet penceresinde mikrofon izni gerekir. Ses bağlantısı henüz doğrulanmadı.';

  if (status.keyStorageAvailable !== true) {
    const message = 'Bu bilgisayarda güvenli anahtar saklama kullanılamıyor. Anahtar kaydetme şu anda kapalı.';
    fieldError('setup-error', message);
    fieldError('settings-error', message);
    $('key-help').textContent = 'Güvenli saklama hazır olmadan anahtarınızı girmeyin.';
  } else {
    $('key-help').textContent = 'Bir kez girmeniz yeterli. Anahtarınız bu bilgisayarda güvenli olarak saklanır.';
  }

  updateControls();
  if (phase !== lastPhase) {
    $('status-announcement').textContent = `${labels[phase]}. ${phase === 'error' ? $('error-message').textContent : ''}`;
    lastPhase = phase;
  }
}

async function act(operation, successMessage = '') {
  if (busy) return null;
  busy = true;
  notice();
  updateControls();
  try {
    const status = await operation();
    if (status && typeof status === 'object') applyStatus(status);
    if (successMessage && status?.phase !== 'error') notice(successMessage);
    return status;
  } catch (error) {
    // The native process supplies safe, user-facing messages. Never render HTML.
    notice(typeof error?.message === 'string' ? error.message : 'İşlem tamamlanamadı. Lütfen yeniden deneyin.', true);
    return null;
  } finally {
    busy = false;
    updateControls();
  }
}

async function start() {
  if (!currentStatus?.hasKey) {
    applyStatus({ ...currentStatus, phase: 'welcome', gatewayReady: false });
    $('setup-key').focus();
    return;
  }
  $('settings').open = false;
  await act(async () => {
    const status = await api.start();
    if (status?.phase === 'ready' && status.gatewayReady) await api.openPanel();
    return status;
  });
}

function bindVisibility(fieldId, buttonId) {
  $(buttonId).addEventListener('click', () => {
    const field = $(fieldId);
    const visible = field.type === 'password';
    field.type = visible ? 'text' : 'password';
    $(buttonId).textContent = visible ? 'Gizle' : 'Göster';
    $(buttonId).setAttribute('aria-pressed', String(visible));
    $(buttonId).setAttribute('aria-label', visible ? 'Anahtarı gizle' : 'Anahtarı göster');
  });
}

async function saveKeyAndMaybeStart(event, isInitial) {
  event.preventDefault();
  if (busy) return;
  const fieldId = isInitial ? 'setup-key' : 'settings-key';
  const errorId = isInitial ? 'setup-error' : 'settings-error';
  const key = $(fieldId).value.trim();
  fieldError(errorId);
  if (!key) {
    fieldError(errorId, 'Lütfen Gemini API anahtarınızı girin.');
    $(fieldId).focus();
    return;
  }
  clearKey(fieldId, isInitial ? 'show-setup-key' : 'show-settings-key');
  const status = await act(() => api.saveKey(key), isInitial ? '' : 'Yeni anahtar kaydedildi. GIDEON’u yeniden açtığınızda kullanılacak.');
  if (!status?.hasKey || status.phase === 'error') return;
  if (isInitial) await start();
}

function bindEvents() {
  bindVisibility('setup-key', 'show-setup-key');
  bindVisibility('settings-key', 'show-settings-key');
  $('setup-form').addEventListener('submit', (event) => void saveKeyAndMaybeStart(event, true));
  $('settings-form').addEventListener('submit', (event) => void saveKeyAndMaybeStart(event, false));
  $('welcome-start-button').addEventListener('click', () => void start());
  $('retry-button').addEventListener('click', () => void start());
  $('open-panel-button').addEventListener('click', () => void act(() => api.openPanel()));
  for (const id of ['get-key-button', 'settings-get-key-button']) {
    $(id).addEventListener('click', () => void act(() => api.openKeyPage()));
  }
  $('stop-button').addEventListener('click', () => void act(() => api.stop(), 'GIDEON durduruldu. İstediğiniz zaman yeniden açabilirsiniz.'));
  $('error-settings-button').addEventListener('click', () => {
    $('settings').open = true;
    $('settings').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    $('settings-key').focus({ preventScroll: true });
  });
  $('forget-key-button').addEventListener('click', () => {
    $('forget-confirmation').hidden = false;
    $('cancel-forget-button').focus();
  });
  $('cancel-forget-button').addEventListener('click', () => {
    $('forget-confirmation').hidden = true;
    $('forget-key-button').focus();
  });
  $('confirm-forget-button').addEventListener('click', async () => {
    const status = await act(() => api.forgetKey(), 'Kaydedilen anahtar silindi.');
    if (status && !status.hasKey) {
      $('forget-confirmation').hidden = true;
      clearKey('settings-key', 'show-settings-key');
      clearKey('setup-key', 'show-setup-key');
      $('settings').open = false;
      $('setup-key').focus();
    }
  });
  for (const id of ['setup-key', 'settings-key']) {
    $(id).addEventListener('input', () => fieldError(id === 'setup-key' ? 'setup-error' : 'settings-error'));
  }
  window.addEventListener('beforeunload', () => {
    unsubscribe?.();
    clearKey('setup-key', 'show-setup-key');
    clearKey('settings-key', 'show-settings-key');
  });
}

async function initialize() {
  if (!api || typeof api.getStatus !== 'function') {
    applyStatus({ phase: 'error', message: 'Bu pencereyi GIDEON masaüstü uygulamasından açın.', hasKey: false, keyStorageAvailable: false, gatewayReady: false });
    for (const control of controls) control.disabled = true;
    return;
  }
  bindEvents();
  unsubscribe = api.onStatus(applyStatus);
  const status = await act(() => api.getStatus());
  if (!status && !currentStatus) {
    applyStatus({ phase: 'error', message: 'GIDEON’un durumu alınamadı. Uygulamayı kapatıp tekrar açın.', hasKey: false, keyStorageAvailable: false, gatewayReady: false });
  }
}

void initialize();
