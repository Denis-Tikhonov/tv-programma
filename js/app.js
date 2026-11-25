const APP_VERSION = '1.1.1';

const PRESET_SOURCES = [
  {
    id: 'preset-1lot',
    name: '1lot.tv (основной)',
    url: './epg/1lot.xml.gz',
    isPreset: true
  },
  {
    id: 'preset-gabbarit',
    name: 'gabbarit (максимум каналов)',
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
      if (this.channels.length) {
        UI.showView('channels');
        UI.renderChannels(this.channels, this.favorites);
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
    // Menu
    document.getElementById('btn-menu').onclick = () => UI.openMenu();
    document.getElementById('menu-overlay').onclick = () => UI.closeMenu();
    document.querySelectorAll('#side-menu li[data-view]').forEach(li => {
      li.onclick = () => {
        UI.closeMenu();
        const view = li.dataset.view;
        if (view === 'channels') {
          UI.showView('channels');
          UI.renderChannels(this.channels, this.favorites, UI.channelFilter, UI.favoritesOnly);
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
      UI.showView('channels');
      UI.renderChannels(this.channels, this.favorites, UI.channelFilter, true);
    };

    document.getElementById('btn-go-sources').onclick = () => {
      UI.showView('sources');
      this.renderSourcesList();
    };

    document.getElementById('btn-search').onclick = () => {
      UI.showView('search');
      document.getElementById('search-input').focus();
    };

    // Channels filter
    document.getElementById('filter-channels').oninput = Utils.debounce((e) => {
      UI.channelFilter = e.target.value;
      UI.renderChannels(this.channels, this.favorites, UI.channelFilter, UI.favoritesOnly);
    }, 200);

    document.getElementById('btn-fav-only').onclick = () => {
      UI.favoritesOnly = !UI.favoritesOnly;
      document.getElementById('btn-fav-only').textContent = UI.favoritesOnly ? '★ Все' : '★ Избранные';
      UI.renderChannels(this.channels, this.favorites, UI.channelFilter, UI.favoritesOnly);
    };

    // Channel click / fav
    document.getElementById('channels-list').onclick = async (e) => {
      const favBtn = e.target.closest('.fav');
      if (favBtn) {
        e.stopPropagation();
        const id = favBtn.dataset.id;
        const isFav = await DB.toggleFavorite(id);
        if (isFav) this.favorites.add(id);
        else this.favorites.delete(id);
        UI.renderChannels(this.channels, this.favorites, UI.channelFilter, UI.favoritesOnly);
        return;
      }
      const item = e.target.closest('.list-item');
      if (item) this.openChannel(item.dataset.id);
    };

    // Source channels list click
    document.getElementById('source-channels-list').onclick = (e) => {
      const item = e.target.closest('.list-item');
      if (item) this.openChannel(item.dataset.id);
    };

    document.getElementById('btn-back-sources').onclick = () => {
      UI.showView('sources');
      this.renderSourcesList();
    };

    // Sources actions
    document.getElementById('sources-list').onclick = async (e) => {
      const card = e.target.closest('.source-card');
      if (!card) return;
      const id = card.dataset.id;

      if (e.target.classList.contains('btn-open-channels') || (e.target.closest('.btn-open-channels'))) {
        await this.openSourceChannels(id);
        return;
      }
      if (e.target.classList.contains('btn-activate')) {
        await this.activateSource(id);
        return;
      }
      if (e.target.classList.contains('btn-reload')) {
        await this.loadSource(id);
        return;
      }
    };

    // Add custom source
    document.getElementById('btn-add-source').onclick = () => this.addCustomSource();

    // Search
    const searchInput = document.getElementById('search-input');
    document.getElementById('btn-do-search').onclick = () => this.doSearch();
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') this.doSearch();
    };
    // Prevent focus loss: do not re-render history on every keystroke in a way that steals focus
    searchInput.oninput = () => {}; // live search disabled to keep focus; use button or Enter

    document.getElementById('search-history').onclick = (e) => {
      const btn = e.target.closest('button[data-q]');
      if (btn) {
        searchInput.value = btn.dataset.q;
        this.doSearch();
      }
    };

    // Search result → open channel
    document.getElementById('search-results').onclick = (e) => {
      const card = e.target.closest('.prog-card[data-channel]');
      if (card) this.openChannel(card.dataset.channel);
    };
  },

  async renderSourcesList() {
    const saved = await DB.getSources();
    // enrich presets with saved data
    const presets = PRESET_SOURCES.map(p => {
      const s = saved.find(x => x.id === p.id);
      return s ? { ...p, ...s } : { ...p };
    });
    const customs = saved.filter(s => !s.isPreset);
    UI.renderSources(presets, customs, this.activeSourceId);
  },

  async openSourceChannels(sourceId) {
    const source = await DB.getSource(sourceId) || PRESET_SOURCES.find(p => p.id === sourceId);
    if (!source) return;
    let channels = await DB.getChannels(sourceId);
    if (!channels.length && sourceId === this.activeSourceId) {
      channels = this.channels;
    }
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
    UI.showView('channels');
    UI.renderChannels(this.channels, this.favorites);
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

    Utils.showLoading('Загрузка EPG...');
    try {
      const data = await EPG.loadAndParse(source.url, days, (t) => {
        document.getElementById('loading-text').textContent = t;
      });

      await DB.clearSourceData(id);
      const channels = data.channels.map(c => ({ ...c, sourceId: id }));
      await DB.putChannels(channels);
      await DB.putProgrammes(data.programmes);

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

      Utils.hideLoading();
      Utils.toast(`Загружено: ${data.stats.channels} каналов, ${data.stats.programmes} передач`);
      UI.showView('channels');
      UI.renderChannels(this.channels, this.favorites);
      this.renderSourcesList();
    } catch (err) {
      Utils.hideLoading();
      console.error(err);
      Utils.toast('Ошибка: ' + (err.message || 'не удалось загрузить'));
    }
  },

  async addCustomSource() {
    const input = document.getElementById('custom-url');
    const url = (input.value || '').trim();
    if (!url) {
      Utils.toast('Введите URL');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('./')) {
      Utils.toast('URL должен начинаться с http(s)://');
      return;
    }

    // save to history
    this.urlHistory = [url, ...this.urlHistory.filter(u => u !== url)].slice(0, 8);
    await DB.setMeta('urlHistory', this.urlHistory);
    UI.fillUrlHistory(this.urlHistory);

    const id = 'custom-' + btoa(url).replace(/[^a-z0-9]/gi, '').slice(0, 16);
    const name = url.replace(/^https?:\/\//, '').split('/')[0] || 'Свой источник';

    const source = { id, name, url, isPreset: false };
    await DB.saveSource(source);
    await this.loadSource(id);
    input.value = '';
  },

  async openChannel(channelId) {
    const ch = this.channels.find(c => c.id === channelId);
    const name = ch ? ch.name : channelId;
    Utils.showLoading('Загрузка программы...');
    try {
      const programmes = await DB.getProgrammesByChannel(channelId);
      Utils.hideLoading();
      UI.renderProgrammes(programmes, name);
      UI.showView('programmes');
    } catch (e) {
      Utils.hideLoading();
      Utils.toast('Ошибка загрузки программы');
    }
  },

  async doSearch() {
    const input = document.getElementById('search-input');
    const q = (input.value || '').trim();
    if (q.length < 1) {
      Utils.toast('Введите запрос');
      return;
    }

    // history
    this.searchHistory = [q, ...this.searchHistory.filter(x => x !== q)].slice(0, 10);
    await DB.setMeta('searchHistory', this.searchHistory);
    UI.renderSearchHistory(this.searchHistory);

    Utils.showLoading('Поиск...');
    try {
      const results = await DB.searchProgrammes(q);
      Utils.hideLoading();
      UI.renderSearchResults(results);
      // keep focus-friendly: no forced blur
      input.focus();
    } catch (e) {
      Utils.hideLoading();
      Utils.toast('Ошибка поиска');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

// Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
