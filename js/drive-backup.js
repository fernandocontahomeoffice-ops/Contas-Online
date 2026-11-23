// =======================================================================
// Google Drive Backup Integration (Client-Side Firebase Auth + GIS Fallback + Drive v3)
// =======================================================================
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTO_BACKUP_FILENAME = 'contas_online_auto_backup.json';

const PREF_AUTO_ENABLED = 'gdrive_auto_backup_enabled';
const PREF_AUTO_CONSENTED = 'gdrive_auto_backup_consented';
const PREF_FILE_ID = 'gdrive_backup_file_id';
const PREF_LAST_BACKUP_AT = 'gdrive_last_backup_at';
const PREF_LAST_MODE = 'gdrive_last_backup_mode';

// Token mantido exclusivamente em memória (nunca em localStorage ou sessionStorage)
let cachedAccessToken = null;
let tokenExpiresAt = 0;

let firebaseConfig = null;
let firebaseAuth = null;
let googleProvider = null;
let currentUser = null;
let authMethod = null; // 'firebase' | 'gis'
let initPromise = null;

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const num = parseInt(bytes, 10);
  if (!num || isNaN(num)) return '-';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTimePT(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch (e) {
    return iso;
  }
}

function loadGisScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      let checks = 0;
      const timer = setInterval(() => {
        checks++;
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (checks > 40) {
          clearInterval(timer);
          reject(new Error('Google Identity Services não carregou a tempo.'));
        }
      }, 100);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar Google Identity Services.'));
    document.head.appendChild(s);
  });
}

window.App = window.App || {};

App.driveBackup = {
  _debounceTimer: null,
  _syncInProgress: false,
  _pendingResync: false,
  _hasUnsyncedChanges: false,
  _statusState: 'idle', // idle | pending | syncing | synced | needs_reauth | error
  _statusMessage: '',
  _backupsList: [],
  _isLoadingList: false,

  async init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const res = await fetch('/firebase-applet-config.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('Configuração do Firebase não encontrada.');
        firebaseConfig = await res.json();
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        firebaseAuth = getAuth(app);
        googleProvider = new GoogleAuthProvider();
        googleProvider.addScope(DRIVE_SCOPE);
        googleProvider.setCustomParameters({ prompt: 'select_account' });

        onAuthStateChanged(firebaseAuth, (user) => {
          if (authMethod === 'gis' && cachedAccessToken) {
            return;
          }
          currentUser = user || null;
          if (!user) {
            cachedAccessToken = null;
            tokenExpiresAt = 0;
            this._backupsList = [];
            if (this._statusState !== 'error') {
              this._statusState = 'idle';
              this._statusMessage = '';
            }
          } else if (!this.hasValidToken()) {
            this._statusState = 'needs_reauth';
            this._statusMessage = 'Sessão restaurada. Reconecte com o Google para autorizar envios ao Drive nesta aba.';
          }
          this.renderUI();
        });
      } catch (err) {
        console.error('Erro ao inicializar integração Google Drive:', err);
        this._statusState = 'error';
        this._statusMessage = 'Falha ao carregar configuração do Google Drive.';
        this.renderUI();
      }
    })();
    return initPromise;
  },

  hasValidToken() {
    return Boolean(cachedAccessToken) && Date.now() < tokenExpiresAt;
  },

  isAutoBackupEnabled() {
    return localStorage.getItem(PREF_AUTO_ENABLED) === 'true';
  },

  hasAutoConsent() {
    return localStorage.getItem(PREF_AUTO_CONSENTED) === 'true';
  },

  _clearToken() {
    cachedAccessToken = null;
    tokenExpiresAt = 0;
  },

  async _fetchDriveUserProfile() {
    if (!this.hasValidToken()) return null;
    try {
      const res = await this._driveFetch(
        'https://www.googleapis.com/drive/v3/about?fields=' + encodeURIComponent('user(displayName,emailAddress,photoLink)')
      );
      const data = await res.json();
      if (data && data.user) {
        return {
          displayName: data.user.displayName || 'Conta Google conectada',
          email: data.user.emailAddress || '',
          photoURL: data.user.photoLink || ''
        };
      }
    } catch (e) {}
    return {
      displayName: 'Conta Google conectada',
      email: '',
      photoURL: ''
    };
  },

  async _signInWithGis() {
    await loadGisScript();
    const clientId = firebaseConfig?.oAuthClientId;
    if (!clientId) {
      throw new Error('oAuthClientId não encontrado na configuração do aplicativo.');
    }
    if (!window.google?.accounts?.oauth2?.initTokenClient) {
      throw new Error('Cliente OAuth do Google indisponível no navegador.');
    }

    return new Promise((resolve, reject) => {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: async (tokenResponse) => {
            if (!tokenResponse || tokenResponse.error) {
              const code = tokenResponse?.error || 'gis_error';
              if (code === 'popup_closed' || code === 'access_denied') {
                resolve(false);
                return;
              }
              reject(new Error(tokenResponse?.error_description || code));
              return;
            }
            if (!tokenResponse.access_token) {
              reject(new Error('Token de acesso não retornado pelo Google.'));
              return;
            }
            cachedAccessToken = tokenResponse.access_token;
            const expiresInSec = parseInt(tokenResponse.expires_in, 10) || 3500;
            tokenExpiresAt = Date.now() + Math.max(300, expiresInSec - 120) * 1000;
            authMethod = 'gis';
            currentUser = await this._fetchDriveUserProfile();
            resolve(true);
          },
          error_callback: (err) => {
            if (err && (err.type === 'popup_closed' || err.type === 'popup_failed_to_open')) {
              reject(Object.assign(new Error(err.message || err.type), { code: err.type }));
            } else {
              reject(new Error(err?.message || 'Erro ao autenticar com o Google.'));
            }
          }
        });
        tokenClient.requestAccessToken({ prompt: 'select_account' });
      } catch (err) {
        reject(err);
      }
    });
  },

  async _onSignInSuccess() {
    this._statusState = 'idle';
    this._statusMessage = 'Conectado ao Google Drive.';
    this.renderUI();
    await this.refreshBackupsList();

    if (this._hasUnsyncedChanges && this.isAutoBackupEnabled()) {
      this._hasUnsyncedChanges = false;
      await this.performBackup({ mode: 'auto', silentSuccess: false });
    } else if (!this.hasAutoConsent() && !this.isAutoBackupEnabled()) {
      App.utils.confirm(
        `Deseja ativar o backup automático no Google Drive${currentUser?.email ? ` (${currentUser.email})` : ''}? Sempre que houver uma alteração no Contas Online, o arquivo "${AUTO_BACKUP_FILENAME}" no seu Drive será atualizado automaticamente.`,
        async () => {
          localStorage.setItem(PREF_AUTO_ENABLED, 'true');
          localStorage.setItem(PREF_AUTO_CONSENTED, 'true');
          this.renderUI();
          await this.performBackup({ mode: 'auto', silentSuccess: false });
        },
        () => {
          localStorage.setItem(PREF_AUTO_ENABLED, 'false');
          localStorage.setItem(PREF_AUTO_CONSENTED, 'true');
          this.renderUI();
        }
      );
    } else {
      App.utils?.showToast?.('Conectado ao Google Drive!');
    }
  },

  async signIn() {
    await this.init();

    if (!firebaseAuth || !googleProvider) {
      if (firebaseConfig?.oAuthClientId) {
        return this.signInWithGisDirect();
      }
      App.utils?.showToast?.('Serviço de autenticação indisponível.', 'error');
      return false;
    }

    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential || !credential.accessToken) {
        throw new Error('Não foi possível obter a permissão de acesso ao Google Drive.');
      }
      cachedAccessToken = credential.accessToken;
      tokenExpiresAt = Date.now() + 50 * 60 * 1000;
      authMethod = 'firebase';
      currentUser = result.user;
      await this._onSignInSuccess();
      return true;
    } catch (err) {
      if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
        return false;
      }

      console.error('Erro ao conectar Google Drive:', err);
      const host = window.location.hostname || '';
      const origin = window.location.origin || '';
      this._statusState = 'error';
      if (err && (err.code === 'auth/unauthorized-domain' || err.code === 'auth/operation-not-supported-in-this-environment')) {
        this._statusMessage = `Domínio "${host}" não autorizado no Firebase Auth. Adicione "${host}" em Firebase Console → Authentication → Settings → Authorized domains (ou adicione "${origin}" nas Origens JavaScript autorizadas do OAuth no Google Cloud Console).`;
      } else {
        this._statusMessage = err?.message || 'Falha ao autenticar com o Google.';
      }
      App.utils?.showToast?.('Não foi possível conectar ao Google Drive.', 'error');
      this.renderUI();
      return false;
    }
  },

  async signInWithGisDirect() {
    await this.init();
    if (!firebaseConfig?.oAuthClientId) {
      App.utils?.showToast?.('Cliente OAuth não configurado.', 'error');
      return false;
    }
    try {
      const ok = await this._signInWithGis();
      if (ok) {
        await this._onSignInSuccess();
      }
      return ok;
    } catch (gisErr) {
      console.error('Erro no login direto Google:', gisErr);
      const origin = window.location.origin || '';
      this._statusState = 'error';
      this._statusMessage = `Falha no OAuth direto (${gisErr?.message || 'origin_mismatch'}). Verifique se "${origin}" está em Origens JavaScript autorizadas no Google Cloud Console.`;
      App.utils?.showToast?.('Erro ao autenticar com o Google.', 'error');
      this.renderUI();
      return false;
    }
  },

  async signOut() {
    await this.init();
    const tokenToRevoke = cachedAccessToken;
    this._clearToken();
    clearTimeout(this._debounceTimer);
    this._pendingResync = false;
    this._hasUnsyncedChanges = false;
    this._backupsList = [];
    this._statusState = 'idle';
    this._statusMessage = '';
    currentUser = null;
    if (authMethod === 'gis' && tokenToRevoke && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(tokenToRevoke, () => {});
      } catch (e) {}
    }
    authMethod = null;
    if (firebaseAuth) {
      try {
        await firebaseSignOut(firebaseAuth);
      } catch (e) {}
    }
    this.renderUI();
    App.utils?.showToast?.('Desconectado do Google Drive.');
  },

  toggleAutoBackup(enabled) {
    const toggleEl = document.getElementById('gdriveAutoBackupToggle');
    if (enabled) {
      if (toggleEl) toggleEl.checked = false;
      App.utils.confirm(
        `Ativar backup automático no Google Drive? A cada alteração feita no aplicativo (transações, contas, cartões, investimentos, veículos, etc.), o arquivo "${AUTO_BACKUP_FILENAME}" no seu Google Drive será atualizado automaticamente.`,
        async () => {
          localStorage.setItem(PREF_AUTO_ENABLED, 'true');
          localStorage.setItem(PREF_AUTO_CONSENTED, 'true');
          if (toggleEl) toggleEl.checked = true;
          this.renderUI();
          if (this.hasValidToken()) {
            await this.performBackup({ mode: 'auto', silentSuccess: false });
          } else {
            App.utils?.showToast?.('Backup automático ativado. Conecte-se com o Google para iniciar o envio.');
          }
        },
        () => {
          localStorage.setItem(PREF_AUTO_ENABLED, 'false');
          if (toggleEl) toggleEl.checked = false;
          this.renderUI();
        }
      );
    } else {
      localStorage.setItem(PREF_AUTO_ENABLED, 'false');
      clearTimeout(this._debounceTimer);
      this._pendingResync = false;
      this._statusState = 'idle';
      this._statusMessage = 'Backup automático desativado.';
      this.renderUI();
      App.utils?.showToast?.('Backup automático desativado.');
    }
  },

  scheduleAutoBackup(storeName = '', action = '') {
    if (!this.isAutoBackupEnabled()) return;
    if (!currentUser || !this.hasValidToken()) {
      this._hasUnsyncedChanges = true;
      if (currentUser) {
        this._statusState = 'needs_reauth';
        this._statusMessage = 'Alteração registrada localmente. Reconecte com o Google para sincronizar com o Drive.';
        this.renderUI();
      }
      return;
    }

    this._statusState = 'pending';
    this._statusMessage = `Alteração detectada (${storeName || 'dados'}). Sincronizando com o Google Drive...`;
    this.renderUI();

    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._runAutoSync();
    }, 1800);
  },

  async _runAutoSync() {
    if (!this.isAutoBackupEnabled()) return;
    if (!this.hasValidToken()) {
      this._hasUnsyncedChanges = true;
      this._statusState = 'needs_reauth';
      this._statusMessage = 'Sessão expirada. Clique em "Sign in with Google" para sincronizar.';
      this.renderUI();
      return;
    }
    if (this._syncInProgress) {
      this._pendingResync = true;
      return;
    }
    await this.performBackup({ mode: 'auto', silentSuccess: true });
  },

  async _driveFetch(url, options = {}) {
    if (!this.hasValidToken()) {
      throw Object.assign(new Error('Sessão do Google Drive expirada ou não conectada.'), { code: 'NO_TOKEN' });
    }
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${cachedAccessToken}`);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      this._clearToken();
      this._statusState = 'needs_reauth';
      this._statusMessage = 'Autorização do Google Drive expirou. Clique em "Sign in with Google" para reconectar.';
      this.renderUI();
      throw Object.assign(new Error('Autorização do Google Drive expirou (401).'), { status: 401 });
    }
    if (!response.ok) {
      let detail = `Erro ${response.status}`;
      try {
        const errJson = await response.json();
        detail = errJson?.error?.message || detail;
      } catch (e) {}
      throw Object.assign(new Error(detail), { status: response.status });
    }
    return response;
  },

  async _findBackupFileByName(name = AUTO_BACKUP_FILENAME) {
    const q = `name='${name.replace(/'/g, "\\'")}' and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=${encodeURIComponent('files(id,name,modifiedTime,size)')}&orderBy=modifiedTime%20desc&pageSize=5`;
    const res = await this._driveFetch(url);
    const data = await res.json();
    return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
  },

  async refreshBackupsList() {
    await this.init();
    if (!this.hasValidToken()) {
      this._backupsList = [];
      this.renderUI();
      return;
    }
    this._isLoadingList = true;
    this.renderUI();
    try {
      const q = `trashed=false and mimeType='application/json'`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=${encodeURIComponent('files(id,name,modifiedTime,size)')}&orderBy=modifiedTime%20desc&pageSize=15`;
      const res = await this._driveFetch(url);
      const data = await res.json();
      this._backupsList = Array.isArray(data.files) ? data.files : [];
      const autoFile = this._backupsList.find(f => f.name === AUTO_BACKUP_FILENAME);
      if (autoFile) {
        localStorage.setItem(PREF_FILE_ID, autoFile.id);
      }
    } catch (err) {
      if (err?.status !== 401) {
        console.error('Erro ao listar backups no Google Drive:', err);
      }
    } finally {
      this._isLoadingList = false;
      this.renderUI();
    }
  },

  async _uploadMultipart({ fileId = null, fileName, jsonString }) {
    const boundary = '-------contasonline_drive_' + Date.now();
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      description: 'Backup do aplicativo Contas Online'
    };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${jsonString}\r\n` +
      `--${boundary}--`;

    const isUpdate = Boolean(fileId);
    const endpoint = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime,size`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size`;

    const res = await this._driveFetch(endpoint, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary="${boundary}"`
      },
      body
    });
    return res.json();
  },

  async _collectAllStores() {
    const data = {};
    const storeNames = App.db && App.db._db
      ? Array.from(App.db._db.objectStoreNames)
      : [
          'transactions', 'accounts', 'categories', 'investments', 'patrimony', 'members',
          'creditCards', 'goals', 'wishes', 'receipts', 'budgets', 'loans',
          'transactionTemplates', 'investmentHistory', 'accountHistory',
          'creditLimitHistory', 'notifications', 'receiptFolders',
          'vehicles', 'vehicleExpenses', 'previdencia', 'fontesPagadoras',
          'planosOrcamentarios', 'indicatorHistory', 'manualIncomes', 'locais', 'payrolls'
        ];
    for (const s of storeNames) {
      try {
        data[s] = await App.db.getAll(s);
      } catch (e) {
        data[s] = [];
      }
    }
    if (App.config && App.config.INDICATORS) {
      data.app_indicators = App.config.INDICATORS;
    }
    return data;
  },

  async _buildPayload() {
    const raw = await this._collectAllStores();
    let totalRecords = 0;
    Object.values(raw).forEach(arr => {
      if (Array.isArray(arr)) totalRecords += arr.length;
    });
    const payload = {
      _backupMeta: {
        app: 'Contas Online',
        version: App.config?.DB_VERSION || 34,
        createdAt: new Date().toISOString(),
        totalRecords
      },
      ...raw
    };
    return {
      payload,
      totalRecords,
      jsonString: JSON.stringify(payload)
    };
  },

  async performBackup({ mode = 'manual', silentSuccess = false, createNewSnapshot = false } = {}) {
    if (!this.hasValidToken()) {
      if (!silentSuccess) {
        App.utils?.showToast?.('Conecte sua conta Google primeiro para salvar no Google Drive.', 'error');
      }
      this._statusState = currentUser ? 'needs_reauth' : 'idle';
      this.renderUI();
      return null;
    }

    if (this._syncInProgress) {
      this._pendingResync = true;
      return null;
    }

    this._syncInProgress = true;
    this._statusState = 'syncing';
    this._statusMessage = mode === 'auto'
      ? 'Salvando backup automático no Google Drive...'
      : 'Salvando backup manual no Google Drive...';
    this.renderUI();

    try {
      const { jsonString } = await this._buildPayload();
      const targetName = createNewSnapshot
        ? `contas_online_manual_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
        : AUTO_BACKUP_FILENAME;

      let fileId = null;
      if (!createNewSnapshot) {
        fileId = localStorage.getItem(PREF_FILE_ID) || null;
        if (!fileId) {
          const existing = await this._findBackupFileByName(targetName);
          if (existing) fileId = existing.id;
        }
      }

      let savedFile;
      try {
        savedFile = await this._uploadMultipart({ fileId, fileName: targetName, jsonString });
      } catch (err) {
        if (err && err.status === 404 && fileId) {
          localStorage.removeItem(PREF_FILE_ID);
          savedFile = await this._uploadMultipart({ fileId: null, fileName: targetName, jsonString });
        } else {
          throw err;
        }
      }

      if (!createNewSnapshot && savedFile?.id) {
        localStorage.setItem(PREF_FILE_ID, savedFile.id);
      }

      const nowIso = new Date().toISOString();
      localStorage.setItem(PREF_LAST_BACKUP_AT, nowIso);
      localStorage.setItem(PREF_LAST_MODE, mode);
      localStorage.setItem('last_backup_date', nowIso);

      this._hasUnsyncedChanges = false;
      this._statusState = 'synced';
      this._statusMessage = mode === 'auto'
        ? `Backup automático salvo às ${new Date(nowIso).toLocaleTimeString('pt-BR')}.`
        : `Backup manual salvo no Google Drive (${savedFile?.name || targetName}).`;

      await this.refreshBackupsList();

      if (!silentSuccess) {
        App.utils?.showToast?.('Backup salvo no Google Drive!');
      }
      return savedFile;
    } catch (err) {
      console.error('Erro ao salvar backup no Google Drive:', err);
      if (err?.status !== 401) {
        this._statusState = 'error';
        this._statusMessage = `Falha no backup: ${err?.message || 'Erro de rede'}`;
        if (!silentSuccess) {
          App.utils?.showToast?.('Erro ao salvar backup no Google Drive.', 'error');
        }
      }
      this.renderUI();
      return null;
    } finally {
      this._syncInProgress = false;
      if (this._pendingResync) {
        this._pendingResync = false;
        setTimeout(() => this._runAutoSync(), 400);
      }
    }
  },

  async saveManualBackup({ createNewSnapshot = false } = {}) {
    await this.init();
    if (!this.hasValidToken()) {
      App.utils.confirm(
        'Para salvar o backup no Google Drive, conecte sua conta Google agora. Deseja abrir a autenticação do Google?',
        async () => {
          const ok = await this.signIn();
          if (ok) {
            await this.saveManualBackup({ createNewSnapshot });
          }
        }
      );
      return;
    }

    let totalRecords = 0;
    try {
      const data = await this._collectAllStores();
      Object.values(data).forEach(arr => {
        if (Array.isArray(arr)) totalRecords += arr.length;
      });
    } catch (e) {}

    let existingFile = null;
    if (!createNewSnapshot) {
      try {
        const cachedId = localStorage.getItem(PREF_FILE_ID);
        existingFile = this._backupsList.find(f => f.id === cachedId || f.name === AUTO_BACKUP_FILENAME)
          || await this._findBackupFileByName(AUTO_BACKUP_FILENAME);
      } catch (e) {}
    }

    const email = currentUser?.email || 'sua conta Google';
    const message = createNewSnapshot
      ? `Deseja criar um novo arquivo de backup com data/hora no Google Drive (${email}) contendo ${totalRecords} registros?`
      : existingFile
        ? `Deseja salvar agora e sobrescrever o arquivo "${existingFile.name}" no Google Drive (${email}) com os ${totalRecords} registros atuais?`
        : `Deseja criar e salvar o arquivo "${AUTO_BACKUP_FILENAME}" no Google Drive (${email}) com os ${totalRecords} registros atuais?`;

    App.utils.confirm(message, async () => {
      await this.performBackup({ mode: 'manual', silentSuccess: false, createNewSnapshot });
    });
  },

  async restoreBackup(fileId, fileName) {
    if (!fileId) return;
    if (!this.hasValidToken()) {
      App.utils?.showToast?.('Reconecte com o Google primeiro.', 'error');
      return;
    }
    App.utils.confirm(
      `Deseja restaurar os dados do arquivo "${fileName}" do Google Drive? Os registros locais existentes com os mesmos IDs serão atualizados com o conteúdo do backup.`,
      async () => {
        try {
          this._statusState = 'syncing';
          this._statusMessage = `Baixando "${fileName}" do Google Drive...`;
          this.renderUI();

          const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
          const res = await this._driveFetch(url);
          const data = await res.json();

          App.db._suppressAutoBackup = true;
          try {
            for (const [store, items] of Object.entries(data)) {
              if (Array.isArray(items) && items.length) {
                try {
                  await App.db.putMany(store, items);
                } catch (e) {}
              }
            }
            if (data.app_indicators && App.config) {
              App.config.INDICATORS = data.app_indicators;
              localStorage.setItem('app_indicators', JSON.stringify(App.config.INDICATORS));
            }
          } finally {
            App.db._suppressAutoBackup = false;
          }

          await App.db.preloadCache();
          this._statusState = 'synced';
          this._statusMessage = `Backup "${fileName}" restaurado com sucesso.`;
          this.renderUI();
          App.utils?.showToast?.('Backup do Google Drive restaurado!');
          App.ui?.navigateTo?.(App.ui._currentPage || 'panel');
        } catch (err) {
          console.error('Erro ao restaurar backup do Google Drive:', err);
          this._statusState = 'error';
          this._statusMessage = `Erro ao restaurar backup: ${err?.message || 'Falha no download'}`;
          this.renderUI();
          App.utils?.showToast?.('Erro ao restaurar backup do Google Drive.', 'error');
        }
      }
    );
  },

  async deleteBackup(fileId, fileName) {
    if (!fileId) return;
    if (!this.hasValidToken()) {
      App.utils?.showToast?.('Reconecte com o Google primeiro.', 'error');
      return;
    }
    App.utils.confirm(
      `Tem certeza que deseja excluir permanentemente o arquivo "${fileName}" do seu Google Drive? Esta ação não pode ser desfeita.`,
      async () => {
        try {
          await this._driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
            method: 'DELETE'
          });
          if (localStorage.getItem(PREF_FILE_ID) === fileId) {
            localStorage.removeItem(PREF_FILE_ID);
          }
          this._statusState = 'idle';
          this._statusMessage = `Arquivo "${fileName}" excluído do Google Drive.`;
          App.utils?.showToast?.('Backup removido do Google Drive.');
          await this.refreshBackupsList();
        } catch (err) {
          console.error('Erro ao excluir arquivo do Drive:', err);
          App.utils?.showToast?.('Erro ao excluir arquivo do Google Drive.', 'error');
        }
      }
    );
  },

  onPageOpen() {
    this.init().then(() => {
      this.renderUI();
      if (this.hasValidToken()) {
        this.refreshBackupsList();
      }
    });
  },

  renderUI() {
    const authEl = document.getElementById('gdriveAuthArea');
    const controlsEl = document.getElementById('gdriveControlsArea');
    const toggleEl = document.getElementById('gdriveAutoBackupToggle');
    const statusEl = document.getElementById('gdriveStatusBanner');
    const lastEl = document.getElementById('gdriveLastBackupInfo');
    const listEl = document.getElementById('gdriveBackupsList');
    const manualBtn = document.getElementById('gdriveManualSaveBtn');
    const snapshotBtn = document.getElementById('gdriveSnapshotSaveBtn');
    const refreshBtn = document.getElementById('gdriveRefreshListBtn');

    if (!authEl) return;

    const hasToken = this.hasValidToken();
    const autoEnabled = this.isAutoBackupEnabled();

    if (toggleEl) {
      toggleEl.checked = autoEnabled;
    }

    if (hasToken && currentUser) {
      const avatar = currentUser.photoURL
        ? `<img src="${escapeHtml(currentUser.photoURL)}" alt="" class="gdrive-avatar">`
        : '<span class="gdrive-avatar-fallback">G</span>';
      authEl.innerHTML = `
        <div class="gdrive-user-bar">
          <div class="gdrive-user-info">
            ${avatar}
            <div>
              <div class="gdrive-user-name">${escapeHtml(currentUser.displayName || 'Conta Google conectada')}</div>
              <div class="gdrive-user-email">${escapeHtml(currentUser.email || '')}</div>
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick="App.driveBackup.signOut()">Desconectar</button>
        </div>
      `;
    } else {
      const reauthNotice = currentUser
        ? `<p class="gdrive-reauth-note">Conta associada: <strong>${escapeHtml(currentUser.email || '')}</strong>. Clique no botão ao lado para renovar o acesso nesta sessão.</p>`
        : '';
      authEl.innerHTML = `
        <div class="gdrive-signin-wrap">
          <button type="button" id="gdriveSignInBtn" class="gsi-material-button" onclick="App.driveBackup.signIn()" aria-label="Sign in with Google">
            <div class="gsi-material-button-state"></div>
            <div class="gsi-material-button-content-wrapper">
              <div class="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="display: block;">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span class="gsi-material-button-contents">Sign in with Google</span>
            </div>
          </button>
          ${reauthNotice}
        </div>
      `;
    }

    if (controlsEl) {
      controlsEl.classList.toggle('gdrive-disconnected', !hasToken);
    }
    if (manualBtn) manualBtn.disabled = this._syncInProgress;
    if (snapshotBtn) snapshotBtn.disabled = this._syncInProgress;
    if (refreshBtn) refreshBtn.disabled = !hasToken || this._isLoadingList;

    if (statusEl) {
      const stateLabelMap = {
        idle: hasToken ? 'Pronto para salvar no Google Drive.' : 'Conecte sua conta Google para habilitar o envio.',
        pending: this._statusMessage || 'Alteração detectada — aguardando para enviar...',
        syncing: this._statusMessage || 'Sincronizando com o Google Drive...',
        synced: this._statusMessage || 'Backup sincronizado com o Google Drive.',
        needs_reauth: this._statusMessage || 'Reconecte sua conta Google para continuar sincronizando.',
        error: this._statusMessage || 'Erro na sincronização com o Google Drive.'
      };
      statusEl.className = `gdrive-status-banner gdrive-status-${this._statusState}`;
      statusEl.textContent = stateLabelMap[this._statusState] || stateLabelMap.idle;
    }

    if (lastEl) {
      const lastAt = localStorage.getItem(PREF_LAST_BACKUP_AT);
      const lastMode = localStorage.getItem(PREF_LAST_MODE);
      if (lastAt) {
        const modeTxt = lastMode === 'auto' ? 'Automático' : 'Manual';
        lastEl.textContent = `Último backup no Drive: ${formatDateTimePT(lastAt)} (${modeTxt})`;
      } else {
        lastEl.textContent = 'Nenhum backup enviado ao Google Drive ainda neste navegador.';
      }
    }

    if (listEl) {
      if (!hasToken) {
        listEl.innerHTML = '<div class="gdrive-empty-list">Conecte sua conta Google para visualizar e restaurar os backups salvos no Google Drive.</div>';
      } else if (this._isLoadingList) {
        listEl.innerHTML = '<div class="gdrive-empty-list">Carregando backups do Google Drive...</div>';
      } else if (!this._backupsList.length) {
        listEl.innerHTML = '<div class="gdrive-empty-list">Nenhum arquivo de backup encontrado no Google Drive criado por este aplicativo.</div>';
      } else {
        listEl.innerHTML = this._backupsList.map(file => {
          const isAuto = file.name === AUTO_BACKUP_FILENAME;
          const badge = isAuto ? '<span class="gdrive-file-badge">Backup Automático</span>' : '<span class="gdrive-file-badge gdrive-file-badge-manual">Cópia Manual</span>';
          const safeId = escapeHtml(file.id);
          const safeName = escapeHtml(file.name);
          return `
            <div class="gdrive-backup-item">
              <div class="gdrive-backup-meta">
                <div class="gdrive-backup-name">${safeName} ${badge}</div>
                <div class="gdrive-backup-sub">Atualizado em ${escapeHtml(formatDateTimePT(file.modifiedTime))} · ${escapeHtml(formatBytes(file.size))}</div>
              </div>
              <div class="gdrive-backup-actions">
                <button type="button" class="btn btn-outline btn-sm" onclick="App.driveBackup.restoreBackup('${safeId}', '${safeName}')">📥 Restaurar</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="App.driveBackup.deleteBackup('${safeId}', '${safeName}')">🗑️ Excluir</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.driveBackup.init());
} else {
  App.driveBackup.init();
}
