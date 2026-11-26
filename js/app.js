const APP_VERSION = '1.4.0';

const PRESET_SOURCES = [
  {
    id: 'preset-merged',
    name: 'Сводка (1lot + gabbarit)',
    url: './epg/merged.xml.gz',
    isPreset: true
  },
  {
    id: 'preset-1lot',
    name: '1lot.tv (сырой)',
    url: './epg/1lot.xml.gz',
    isPreset: true
  },
  {
    id: 'preset-gabbarit',
    name: 'gabbarit (сырой, тяжёлый)',
    url: './epg/gabbarit.xml.gz',
    isPreset: true
  }
];

const App = {
  activeSourceId: null,
  channels: [],
  favorites: new Set(),
  searchHistory: [],
  urlHistory: [],
  _renameId: null,
  channelsReturnState: { favOnly: false, filter: '' },
  progCounts: new Map(),

  async init() {
    document.getElementById('app-version').textContent = 'v' + APP_VERSION;
    await DB.open();

    this.activeSourceId = await DB.getMeta('activeSourceId');
    this.searchHistory = (await DB.getMeta('searchHistory')) || [];
    this.urlHistory = (await DB.getMeta('urlHistory')) || [];
    this.favorites = await DB.getFavorites();

    UI.fillUrlHistory(this.urlHistory);
    UI.renderSearchHistory(this.searchHistory);

    if (this.activeSourceId) {
      this.channels = await DB.getChannels(this.activeSourceId);
      this.progCounts = await DB.getChannelProgCounts();
      if (this.channels.length) {
        UI.showView('channels');
        this.showChannelsList();
      } else {
        UI.showView('home');
      }
    } else {
      UI.showView('home');
    }

    this.bindEvents();
    this.renderSourcesList();
  },

  bindEvents() {
    document.getElementById('btn-menu').onclick = () => UI.openMenu();
    document.getElementById('menu-overlay').onclick = () => UI.closeMenu();

    document.querySelectorAll('#side-menu li[data-view]').forEach(li => {
      li.onclick = () => {
        UI.closeMenu();
        const view = li.dataset.view;
        if (view === 'channels') {
          UI.favoritesOnly = false;
          this.showChannelsList();
        } else if (view === 'search') {
          UI.showView('search');
        } else if (view === 'sources') {
          UI.showView('sources');
          this.renderSourcesList();
        }
      };
    });

    document.getElementById('menu-favorites').onclick = () => {
      UI.closeMenu();
      UI.favoritesOnly = true;
      this.showChannelsList();
    };

    document.getElementById('btn-go-sources').onclick = () => {
      UI.showView('sources');
      this.renderSourcesList();
    };

    document.getElementById('btn-search').onclick = () => {
      UI.showView('search');
      document.getElementById('search-input').focus();
    };

    document.getElementById('filter-channels').oninput = Utils.debounce((e) => {
      UI.channelFilter = e.target.value;
      this.showChannelsList(false);
    }, 200);

    document.getElementById('btn-fav-only').onclick = () => {
      UI.favoritesOnly = !UI.favoritesOnly;
      document.getElementById('btn-fav-only').textContent = UI.favoritesOnly ? '★ Все' : '★ Избранные';
      this.showChannelsList(false);
    };

    document.getElementById('channels-list').onclick = async (e) => {
      const favBtn = e.target.closest('.fav');
      if (favBtn) {
        e.stopPropagation();
        const id = favBtn.dataset.id;
        const isFav = await DB.toggleFavorite(id);
        if (isFav) this.favorites.add(id);
        else this.favorites.delete(id);
        this.showChannelsList(false);
        return;
      }
      const item = e.target.closest('.list-item');
      if (item) this.openChannel(item.dataset.id);
    };

    document.getElementById('source-channels-list').onclick = (e) => {
      const item = e.target.closest('.list-item');
      if (item) this.openChannel(item.dataset.id);
    };

    document.getElementById('btn-back-sources').onclick = () => {
      UI.showView('sources');
      this.renderSourcesList();
    };

    document.getElementById('sources-list').onclick = async (e) => {
      const renameBtn = e.target.closest('.btn-rename');
      if (renameBtn) {
        this.openRename(renameBtn.dataset.id);
        return;
      }
      const removeBtn = e.target.closest('.btn-remove-source');
      if (removeBtn) {
        e.stopPropagation();
        await this.removeSource(removeBtn.dataset.id);
        return;
      }
      const card = e.target.closest('.source-card');
      if (!card) return;
      const id = card.dataset.id;

      if (e.target.closest('.btn-open-channels')) {
        await this.openSourceChannels(id);
        return;
      }
      if (e.target.closest('.btn-activate')) {
        await this.activateSource(id);
        return;
      }
      if (e.target.closest('.btn-reload')) {
        await this.loadSource(id);
        return;
      }
    };

    // back from programme to channels (delegated — header re-rendered)
    document.getElementById('view-programmes').addEventListener('click', (e) => {
      if (e.target.closest('#btn-back-channels')) {
        UI.favoritesOnly = this.channelsReturnState.favOnly;
        UI.channelFilter = this.channelsReturnState.filter || '';
        const filterEl = document.getElementById('filter-channels');
        if (filterEl) filterEl.value = UI.channelFilter;
        document.getElementById('btn-fav-only').textContent = UI.favoritesOnly ? '★ Все' : '★ Избранные';
        this.showChannelsList();
      }
    });

    document.getElementById('btn-add-source').onclick = () => this.addCustomSource();
    document.getElementById('btn-clear-epg').onclick = () => this.clearEpg();

    document.getElementById('btn-do-search').onclick = () => this.doSearch();
    document.getElementById('search-input').onkeydown = (e) => {
      if (e.key === 'Enter') this.doSearch();
    };

    document.getElementById('search-history').onclick = (e) => {
      const btn = e.target.closest('button[data-q]');
      if (btn) {
        document.getElementById('search-input').value = btn.dataset.q;
        this.doSearch();
      }
    };

    document.getElementById('search-results').onclick = (e) => {
      const card = e.target.closest('.prog-card[data-channel]');
      if (card) this.openChannel(card.dataset.channel);
    };

    document.getElementById('rename-cancel').onclick = () => {
      document.getElementById('rename-modal').classList.add('hidden');
      this._renameId = null;
    };
    document.getElementById('rename-ok').onclick = () => this.saveRename();
  },

  async renderSourcesList() {
    const saved = await DB.getSources();
    const presets = PRESET_SOURCES.map(p => {
      const s = saved.find(x => x.id === p.id);
      return s ? { ...p, ...s, url: p.url, isPreset: true } : { ...p };
    });
    const customs = saved.filter(s => !s.isPreset && !PRESET_SOURCES.find(p => p.id === s.id));
    UI.renderSources(presets, customs, this.activeSourceId);
    UI.updateStorageInfo();
  },

  async openSourceChannels(sourceId) {
    const source = await DB.getSource(sourceId) || PRESET_SOURCES.find(p => p.id === sourceId);
    if (!source) return;
    let channels = await DB.getChannels(sourceId);
    if (!channels.length && sourceId === this.activeSourceId) channels = this.channels;
    if (!channels.length) {
      Utils.toast('Сначала загрузите источник');
      return;
    }
    UI.renderSourceChannels(channels, source.name);
    UI.showView('source-channels');
  },

  async activateSource(id) {
    const source = await DB.getSource(id);
    if (!source || !source.loadedAt) {
      Utils.toast('Сначала загрузите источник');
      return;
    }
    this.activeSourceId = id;
    await DB.setMeta('activeSourceId', id);
    this.channels = await DB.getChannels(id);
    this.progCounts = await DB.getChannelProgCounts();
    this.showChannelsList();
    Utils.toast('Источник выбран');
    this.renderSourcesList();
  },

  async loadSource(id) {
    let source = PRESET_SOURCES.find(p => p.id === id) || await DB.getSource(id);
    if (!source) {
      Utils.toast('Источник не найден');
      return;
    }

    const daysEl = document.querySelector('input[name="days"]:checked');
    const days = daysEl ? parseInt(daysEl.value, 10) : 3;

    UI.showLoading('Скачивание...', 0);
    try {
      const data = await EPG.loadAndParse(source.url, days, (text, pct) => {
        UI.setLoading(text, pct);
      });

      UI.setLoading('Сохранение в базу...', 98);
      const channels = data.channels.map(c => ({ ...c, sourceId: id }));
      await DB.replaceSourceData(id, channels, data.programmes);

      const saved = {
        id,
        name: source.name,
        url: source.url,
        isPreset: !!source.isPreset,
        loadedAt: Date.now(),
        channelCount: data.stats.channels,
        programmeCount: data.stats.programmes,
        days
      };
      await DB.saveSource(saved);

      this.activeSourceId = id;
      await DB.setMeta('activeSourceId', id);
      this.channels = channels;
      this.progCounts = await DB.getChannelProgCounts();

      UI.hideLoading();
      Utils.toast(`Готово: ${data.stats.channels} каналов, ${data.stats.programmes} передач`);
      this.showChannelsList();
      this.renderSourcesList();
    } catch (err) {
      UI.hideLoading();
      console.error(err);
      Utils.toast('Ошибка: ' + (err.message || 'не удалось загрузить'));
    }
  },

  async addCustomSource() {
    const input = document.getElementById('custom-url');
    const nameInput = document.getElementById('custom-name');
    const url = (input.value || '').trim();
    if (!url) {
      Utils.toast('Введите URL');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('./')) {
      Utils.toast('URL должен начинаться с http(s)://');
      return;
    }

    this.urlHistory = [url, ...this.urlHistory.filter(u => u !== url)].slice(0, 8);
    await DB.setMeta('urlHistory', this.urlHistory);
    UI.fillUrlHistory(this.urlHistory);

    const id = 'custom-' + btoa(unescape(encodeURIComponent(url))).replace(/[^a-z0-9]/gi, '').slice(0, 16);
    const name = (nameInput.value || '').trim() ||
      url.replace(/^https?:\/\//, '').split('/')[0] || 'Свой источник';

    const source = { id, name, url, isPreset: false };
    await DB.saveSource(source);
    nameInput.value = '';
    input.value = '';
    await this.loadSource(id);
  },

  openRename(id) {
    this._renameId = id;
    DB.getSource(id).then(s => {
      document.getElementById('rename-input').value = s ? s.name : '';
      document.getElementById('rename-modal').classList.remove('hidden');
      document.getElementById('rename-input').focus();
    });
  },

  async saveRename() {
    const id = this._renameId;
    if (!id) return;
    const name = document.getElementById('rename-input').value.trim();
    if (!name) {
      Utils.toast('Введите название');
      return;
    }
    const s = await DB.getSource(id);
    if (s) {
      s.name = name;
      await DB.saveSource(s);
    }
    document.getElementById('rename-modal').classList.add('hidden');
    this._renameId = null;
    this.renderSourcesList();
    Utils.toast('Название сохранено');
  },

  async clearEpg() {
    if (!confirm('Очистить каналы и передачи?\nИзбранное и история поиска сохранятся.')) return;
    UI.showLoading('Очистка...', 50);
    try {
      await DB.clearEpgData();
      this.activeSourceId = null;
      this.channels = [];
      UI.hideLoading();
      Utils.toast('EPG очищен');
      UI.showView('home');
      this.renderSourcesList();
    } catch (e) {
      UI.hideLoading();
      Utils.toast('Ошибка очистки');
    }
  },

  async openChannel(channelId) {
    this.channelsReturnState = {
      favOnly: UI.favoritesOnly,
      filter: UI.channelFilter || ''
    };
    const ch = this.channels.find(c => c.id === channelId);
    const name = ch ? ch.name : channelId;
    UI.showLoading('Загрузка программы...', 30);
    try {
      const programmes = await DB.getProgrammesByChannel(channelId);
      UI.hideLoading();
      UI.renderProgrammes(programmes, name);
      UI.showView('programmes');
    } catch (e) {
      UI.hideLoading();
      Utils.toast('Ошибка загрузки программы');
    }
  },

  showChannelsList(switchView = true) {
    if (switchView) UI.showView('channels');
    UI.renderChannels(
      this.channels,
      this.favorites,
      UI.channelFilter,
      UI.favoritesOnly,
      this.progCounts
    );
  },

  async removeSource(id) {
    const preset = PRESET_SOURCES.find(p => p.id === id);
    const saved = await DB.getSource(id);
    const isPreset = !!(preset || (saved && saved.isPreset));
    const name = (saved && saved.name) || (preset && preset.name) || id;

    if (isPreset) {
      if (!confirm(`Очистить из памяти «${name}»?`)) return;
      await DB.unloadSourceData(id);
    } else {
      if (!confirm(`Удалить источник «${name}»?`)) return;
      await DB.deleteSource(id);
    }

    const wasActive = this.activeSourceId === id;
    if (wasActive) {
      this.activeSourceId = null;
      this.channels = [];
      this.progCounts = new Map();
      await DB.setMeta('activeSourceId', null);

      // focus another loaded source
      const all = await DB.getSources();
      const loaded = all.filter(s => s.loadedAt && s.id !== id);
      // also presets may be in all after load
      if (loaded.length) {
        // prefer another preset if any
        const next = loaded.find(s => s.isPreset) || loaded[0];
        await this.activateSource(next.id);
        Utils.toast(isPreset ? 'Очищено' : 'Удалено · переключено на другой источник');
      } else {
        UI.showView('home');
        Utils.toast(isPreset ? 'Очищено' : 'Источник удалён');
      }
    } else {
      Utils.toast(isPreset ? 'Очищено' : 'Источник удалён');
    }
    this.renderSourcesList();
  },

  async doSearch() {
    const input = document.getElementById('search-input');
    const q = (input.value || '').trim();
    if (q.length < 1) {
      Utils.toast('Введите запрос');
      return;
    }

    this.searchHistory = [q, ...this.searchHistory.filter(x => x !== q)].slice(0, 10);
    await DB.setMeta('searchHistory', this.searchHistory);
    UI.renderSearchHistory(this.searchHistory);

    UI.showLoading('Поиск...', 40);
    try {
      const results = await DB.searchProgrammes(q);
      UI.hideLoading();
      UI.renderSearchResults(results);
      input.focus();
    } catch (e) {
      UI.hideLoading();
      Utils.toast('Ошибка поиска');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
