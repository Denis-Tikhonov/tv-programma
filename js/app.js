/**
 * Main application logic — ТВ программа
 */

// Предустановленные источники (файлы лежат в /epg/ на GitHub Pages)
const PRESET_SOURCES = [
  {
    id: 'preset-1lot',
    name: '1lot.tv (основной)',
    url: './epg/1lot.xml.gz',
    description: 'Популярные российские каналы'
  },
  {
    id: 'preset-backup',
    name: 'Резервный источник',
    url: './epg/backup.xml.gz',
    description: 'Запасной EPG (будет добавлен позже)'
  }
];

const App = {
  sources: [],          // custom sources from IndexedDB
  activeSourceId: null,
  channels: [],
  favorites: [],
  currentScreen: 'sources',

  async init() {
    UI.init();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
      } catch (e) {
        console.warn('SW registration failed', e);
      }
    }

    await openDB();
    this.activeSourceId = await getSetting('activeSourceId', null);
    this.sources = await getAllSources();

    // Event listeners
    document.getElementById('btn-sources').addEventListener('click', () => this.showSources());
    document.getElementById('btn-search').addEventListener('click', () => this.showSearch());

    // Start screen
    if (this.activeSourceId) {
      const all = this.getAllSourcesList();
      const src = all.find(s => s.id === this.activeSourceId);
      if (src && src.loaded) {
        await this.loadChannelsAndShow();
        return;
      }
    }
    this.showSources();
  },

  /** Объединённый список: пресеты + пользовательские */
  getAllSourcesList() {
    const customMap = new Map(this.sources.map(s => [s.id, s]));
    const list = [];

    // Сначала пресеты (с актуальным статусом loaded из БД, если есть)
    PRESET_SOURCES.forEach(p => {
      const saved = customMap.get(p.id);
      list.push({
        ...p,
        isPreset: true,
        loaded: saved ? saved.loaded : false,
        meta: saved ? saved.meta : null,
        period: saved ? saved.period : null
      });
    });

    // Потом только пользовательские (не пресеты)
    this.sources.forEach(s => {
      if (!s.id.startsWith('preset-')) {
        list.push({ ...s, isPreset: false });
      }
    });

    return list;
  },


  // ---------- Sources ----------
  showSources() {
    this.currentScreen = 'sources';
    const allSources = this.getAllSourcesList();
    UI.renderSources(allSources, this.activeSourceId);

    const addBtn = document.getElementById('btn-add-source');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.onAddSource());
    }

    // Select source
    this.mainEl().querySelectorAll('.btn-select-source').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setActiveSource(btn.dataset.id);
      });
    });

    // Load preset / custom that is not loaded yet
    this.mainEl().querySelectorAll('.btn-load-source').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startLoadSource(btn.dataset.id);
      });
    });

    // Delete only custom
    this.mainEl().querySelectorAll('.btn-delete-source').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSource(btn.dataset.id);
      });
    });
  },

  async startLoadSource(id) {
    const all = this.getAllSourcesList();
    const src = all.find(s => s.id === id);
    if (!src) return;

    // For presets we already know the URL, for custom too
    // Show period selection (reuse analyze UI simplified)
    this._pendingLoad = src;
    UI.renderPeriodSelect(src);
    
    const loadBtn = document.getElementById('btn-load-epg');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        const periodInput = document.querySelector('input[name="period"]:checked');
        const period = periodInput ? periodInput.value : '3';
        this.onLoadEpg(src.url, null, period, src);
      });
    }
  },


  mainEl() {
    return document.getElementById('main');
  },

  async onAddSource() {
    const input = document.getElementById('input-url');
    const url = (input?.value || '').trim();
    if (!url) {
      showToast('Введите ссылку на EPG');
      return;
    }
    if (!url.startsWith('http')) {
      showToast('Ссылка должна начинаться с http:// или https://');
      return;
    }

    showLoading('Анализ архива...');
    try {
      // HEAD info
      const headInfo = await fetchEpgInfo(url);

      // Full analyze (download + parse stats)
      const info = await analyzeEpg(url, (msg) => {
        document.getElementById('loading-text').textContent = msg;
      });
      info.lastModified = headInfo.lastModified;
      if (headInfo.size) info.sizeCompressed = headInfo.size;

      hideLoading();
      UI.renderAnalyzeResult(info, url);

      // Bind load button
      const loadBtn = document.getElementById('btn-load-epg');
      if (loadBtn) {
        loadBtn.addEventListener('click', () => this.onLoadEpg(url, info, null, null));
      }
    } catch (err) {
      hideLoading();
      console.error(err);
      showToast('Ошибка: ' + (err.message || 'не удалось проанализировать'));
    }
  },


  async onLoadEpg(url, analyzeInfo, forcedPeriod = null, existingSource = null) {
    const periodInput = document.querySelector('input[name="period"]:checked');
    const period = forcedPeriod || (periodInput ? periodInput.value : '3');

    showLoading('Загрузка EPG...');
    try {
      const result = await loadEpg(url, period, (msg) => {
        const el = document.getElementById('loading-text');
        if (el) el.textContent = msg;
      });

      // Используем id пресета или создаём новый
      const sourceId = existingSource ? existingSource.id : uid();
      const source = {
        id: sourceId,
        url,
        name: existingSource ? existingSource.name : this.guessName(url, analyzeInfo),
        description: existingSource ? existingSource.description : null,
        isPreset: existingSource ? !!existingSource.isPreset : false,
        addedAt: Date.now(),
        period,
        loaded: true,
        meta: {
          ...(analyzeInfo || {}),
          channelCount: result.meta.channelCount,
          programmeCountLoaded: result.meta.programmeCountLoaded,
          dateFrom: result.meta.dateFrom,
          dateTo: result.meta.dateTo,
          generator: result.meta.generator,
          loadedAt: Date.now()
        }
      };

      // Очищаем старые данные этого источника перед записью новых
      await clearSourceData(sourceId);

      const channels = result.channels.map(ch => ({
        ...ch,
        id: sourceId + '::' + ch.originalId,
        sourceId
      }));

      const channelIdMap = new Map();
      channels.forEach(ch => channelIdMap.set(ch.originalId, ch.id));

      const programmes = result.programmes.map(p => ({
        ...p,
        id: sourceId + '::' + p.originalChannelId + '::' + p.start,
        sourceId,
        channelId: channelIdMap.get(p.originalChannelId) || (sourceId + '::' + p.originalChannelId)
      }));

      document.getElementById('loading-text').textContent = 'Сохранение...';
      await saveSource(source);
      await saveChannels(channels);
      await saveProgrammes(programmes);

      this.sources = await getAllSources();
      await this.setActiveSource(sourceId);

      hideLoading();
      showToast(`Загружено ${channels.length} каналов, ${programmes.length} передач`);
      await this.loadChannelsAndShow();
    } catch (err) {
      hideLoading();
      console.error(err);
      showToast('Ошибка загрузки: ' + (err.message || 'неизвестно'));
    }
  },


  guessName(url, info) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return info.generator || 'Источник';
    }
  },

  async setActiveSource(id) {
    this.activeSourceId = id;
    await setSetting('activeSourceId', id);
    this.sources = await getAllSources();
    await this.loadChannelsAndShow();
  },

  async deleteSource(id) {
    if (!confirm('Удалить этот источник и все его данные?')) return;
    await deleteSource(id);
    if (this.activeSourceId === id) {
      this.activeSourceId = null;
      await setSetting('activeSourceId', null);
    }
    this.sources = await getAllSources();
    this.showSources();
    showToast('Источник удалён');
  },

  // ---------- Channels ----------
  async loadChannelsAndShow() {
    if (!this.activeSourceId) {
      this.showSources();
      return;
    }
    showLoading('Загрузка каналов...');
    this.channels = await getChannelsBySource(this.activeSourceId);
    this.favorites = await getFavorites(this.activeSourceId);
    hideLoading();
    this.showChannels();
  },

  showChannels() {
    this.currentScreen = 'channels';
    const src = this.sources.find(s => s.id === this.activeSourceId);
    UI.renderChannels(this.channels, this.favorites, src ? src.name : '');

    // Click on channel
    this.mainEl().querySelectorAll('.channel-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.fav-btn')) return;
        this.showProgrammes(el.dataset.id);
      });
    });

    // Favorite toggle
    this.mainEl().querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const idx = this.favorites.indexOf(id);
        if (idx >= 0) {
          this.favorites.splice(idx, 1);
        } else {
          this.favorites.push(id);
        }
        await setFavorites(this.activeSourceId, this.favorites);
        this.showChannels(); // re-render
      });
    });
  },

  // ---------- Programmes ----------
  async showProgrammes(channelId) {
    const channel = this.channels.find(c => c.id === channelId);
    if (!channel) return;

    showLoading('Загрузка программы...');
    // Load a wider window (all loaded data for this channel)
    const programmes = await getProgrammesByChannel(channelId);
    hideLoading();

    this.currentScreen = 'programmes';
    UI.renderProgrammes(channel, programmes);

    const back = document.getElementById('btn-back-channels');
    if (back) back.addEventListener('click', () => this.showChannels());
  },

  // ---------- Search ----------
  async showSearch() {
    if (!this.activeSourceId) {
      showToast('Сначала выберите источник');
      this.showSources();
      return;
    }

    this.currentScreen = 'search';
    this._channelsMap = new Map(this.channels.map(c => [c.id, c]));
    this._searchQuery = '';
    this._renderSearchResults([]);

    // Use event delegation on main for results clicks
    // Input handling is attached once per showSearch
  },

  _renderSearchResults(results) {
    UI.renderSearch(results, this._channelsMap || new Map());

    const input = document.getElementById('search-input');
    if (input) {
      input.value = this._searchQuery || '';
      input.focus();

      // Remove old listener by cloning (simple way)
      const newInput = input.cloneNode(true);
      input.parentNode.replaceChild(newInput, input);
      newInput.value = this._searchQuery || '';

      let timer = null;
      newInput.addEventListener('input', () => {
        clearTimeout(timer);
        this._searchQuery = newInput.value;
        timer = setTimeout(async () => {
          const q = newInput.value.trim();
          if (q.length < 2) {
            this._renderSearchResults([]);
            return;
          }
          showLoading('Поиск...');
          try {
            const results = await searchProgrammes(this.activeSourceId, q);
            hideLoading();
            this._renderSearchResults(results);
          } catch (e) {
            hideLoading();
            showToast('Ошибка поиска');
          }
        }, 350);
      });
    }

    // Result clicks
    this.mainEl().querySelectorAll('[data-channel-id]').forEach(el => {
      el.addEventListener('click', () => {
        this.showProgrammes(el.dataset.channelId);
      });
    });
  }
};


// Делаем App доступным глобально (для кнопки «Отмена»)
window.App = App;

// Boot
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(err => {
    console.error(err);
    showToast('Ошибка инициализации');
  });
});

