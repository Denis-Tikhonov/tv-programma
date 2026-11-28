const UI = {
  currentView: 'home',
  favoritesOnly: false,
  channelFilter: '',

  showView(name, titleOverride) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + name);
    if (el) el.classList.add('active');
    this.currentView = name;

    const titles = {
      home: 'ТВ программа',
      channels: 'Каналы',
      programmes: 'Программа',
      search: 'Поиск',
      sources: 'Источники EPG',
      'source-channels': 'Каналы источника'
    };
    document.getElementById('header-title').textContent =
      titleOverride || titles[name] || 'ТВ программа';
  },

  openMenu() {
    document.getElementById('side-menu').classList.add('open');
    document.getElementById('menu-overlay').classList.add('open');
  },

  closeMenu() {
    document.getElementById('side-menu').classList.remove('open');
    document.getElementById('menu-overlay').classList.remove('open');
  },

  setLoading(text, pct) {
    document.getElementById('loading-text').textContent = text || 'Загрузка...';
    const bar = document.getElementById('loading-bar');
    const pctEl = document.getElementById('loading-pct');
    if (typeof pct === 'number') {
      bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
      pctEl.textContent = Math.round(pct) + '%';
    } else {
      bar.style.width = '0%';
      pctEl.textContent = '';
    }
  },

  showLoading(text, pct) {
    this.setLoading(text, pct);
    document.getElementById('loading').classList.remove('hidden');
  },

  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
    this.setLoading('', 0);
  },

  async updateStorageInfo() {
    const el = document.getElementById('storage-info');
    if (!el) return;
    try {
      const stats = await DB.countStats();
      let mem = '';
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const used = est.usage || 0;
        const q = est.quota || 0;
        mem = ` · ~${(used / 1048576).toFixed(1)} МБ`;
        if (q) mem += ` / ${(q / 1048576).toFixed(0)} МБ`;
      }
      el.textContent = `В базе: ${stats.channels} кан., ${stats.programmes} пер.${mem}`;
    } catch {
      el.textContent = 'Память: нет данных';
    }
  },

  renderSources(presets, savedSources, activeId) {
    const container = document.getElementById('sources-list');
    // presets first, then custom
    const customs = savedSources.filter(s => !s.isPreset && !presets.find(p => p.id === s.id));
    const all = [...presets, ...customs];

    container.innerHTML = all.map(s => {
      const isActive = s.id === activeId;
      const loaded = s.loadedAt;
      const fresh = Utils.freshness(loaded);
      const statusText = loaded
        ? `Загружено: ${Utils.formatDate(loaded)} · ${s.channelCount || 0} каналов`
        : 'Не загружен';

      const renameBtn = !s.isPreset
        ? `<button class="btn-rename" data-id="${s.id}" title="Переименовать">✎</button>`
        : '';
      const removeTitle = s.isPreset ? 'Очистить из памяти' : 'Удалить источник';
      const removeBtn = `<button class="btn-remove-source" data-id="${s.id}" title="${removeTitle}">✕</button>`;

      let actions = '';
      if (!loaded) {
        actions = `<button class="btn primary btn-reload" data-id="${s.id}">Загрузить</button>`;
      } else if (isActive) {
        actions = `
          <button class="btn btn-reload" data-id="${s.id}">Обновить</button>
          <button class="btn primary btn-open-channels" data-id="${s.id}">Каналы</button>`;
      } else {
        actions = `
          <button class="btn btn-reload" data-id="${s.id}">Обновить</button>
          <button class="btn primary btn-activate" data-id="${s.id}">Выбрать</button>`;
      }

      return `
        <div class="source-card ${isActive ? 'active' : ''}" data-id="${s.id}">
          <div class="top">
            <div>
              <div class="name">${Utils.escapeHtml(s.name)} ${renameBtn}</div>
              <div class="status">${statusText}</div>
              ${loaded ? `<div class="fresh"><span class="dot ${fresh.cls}"></span> ${fresh.text}</div>` : ''}
            </div>
            ${removeBtn}
          </div>
          <div class="actions">${actions}</div>
        </div>
      `;
    }).join('');
  },

  renderChannels(channels, favorites, filter = '', favOnly = false, progCounts = null) {
    const list = document.getElementById('channels-list');
    let items = channels.slice();
    if (favOnly) items = items.filter(c => favorites.has(c.id));
    if (filter) {
      const q = filter.toLowerCase();
      items = items.filter(c => c.name.toLowerCase().includes(q));
    }
    items.sort((a, b) => {
      const af = favorites.has(a.id) ? 0 : 1;
      const bf = favorites.has(b.id) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.name.localeCompare(b.name, 'ru');
    });

    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><p>Нет каналов</p></div>';
      return;
    }

    const counts = progCounts || new Map();
    list.innerHTML = items.map(c => {
      const n = counts.get(c.id) || 0;
      const ind = n > 0
        ? `<span class="prog-ind" title="Есть программа">📅</span>`
        : `<span class="prog-ind empty" title="Нет программы">—</span>`;
      return `
      <div class="list-item" data-id="${c.id}">
        <img class="icon" src="${c.icon || ''}" alt="" onerror="this.style.display='none'">
        <div class="info">
          <div class="name">${Utils.escapeHtml(c.name)}</div>
        </div>
        ${ind}
        <button class="fav ${favorites.has(c.id) ? 'active' : ''}" data-id="${c.id}">★</button>
      </div>`;
    }).join('');
  },

  renderSourceChannels(channels, sourceName) {
    document.getElementById('source-channels-title').textContent = sourceName;
    const list = document.getElementById('source-channels-list');
    list.innerHTML = channels.map(c => `
      <div class="list-item" data-id="${c.id}">
        <img class="icon" src="${c.icon || ''}" alt="" onerror="this.style.display='none'">
        <div class="info">
          <div class="name">${Utils.escapeHtml(c.name)}</div>
        </div>
      </div>
    `).join('');
  },

  renderProgrammes(programmes, channelName) {
    let period = '';
    if (programmes.length) {
      let mn = programmes[0].start, mx = programmes[0].start;
      for (const p of programmes) {
        if (p.start < mn) mn = p.start;
        if (p.start > mx) mx = p.start;
      }
      const a = Utils.formatDate(mn).slice(0, 10);
      const b = Utils.formatDate(mx).slice(0, 10);
      period = a === b ? a : (a + ' – ' + b);
    }

    const meta = programmes.length
      ? (programmes.length + ' передач' + (period ? ' · ' + period : ''))
      : 'Нет передач';

    const header = document.getElementById('programmes-header');
    header.innerHTML = `
      <div class="ph-top">
        <button type="button" class="btn small ph-back" id="btn-back-channels" aria-label="Назад">←</button>
        <div class="ph-titles">
          <div class="ch-meta">${meta}</div>
        </div>
        <button type="button" class="btn small ph-now" id="btn-scroll-now">Сейчас</button>
      </div>
    `;

    const list = document.getElementById('programmes-list');
    const now = Date.now();

    list.innerHTML = programmes.map(p => {
      const day = Utils.dayClass(p.start);
      const isNow = p.start <= now && p.stop > now;
      const openClass = isNow ? 'open' : '';
      const details = [];
      if (p.desc) details.push(`<div class="desc">${Utils.escapeHtml(p.desc)}</div>`);
      if (p.category) details.push(`<span class="category">${Utils.escapeHtml(p.category)}</span>`);
      const detailsHtml = details.length
        ? `<div class="prog-details">${details.join('')}</div>`
        : '';
      return `
        <div class="prog-card day-${day} ${isNow ? 'now' : ''} ${openClass}" data-start="${p.start}">
          <div class="prog-summary">
            <div class="time">
              ${Utils.formatTime(p.start)} – ${Utils.formatTime(p.stop)}
              <span class="badge ${day}">${Utils.formatDayLabel(p.start)}</span>
            </div>
            <div class="title">${Utils.escapeHtml(p.title)}</div>
          </div>
          ${detailsHtml}
        </div>
      `;
    }).join('');

    requestAnimationFrame(() => this.scrollToNow(false));
  },

  scrollToNow(smooth) {
    const list = document.getElementById('programmes-list');
    if (!list) return;
    let target = list.querySelector('.prog-card.now');
    if (!target) {
      const now = Date.now();
      const cards = list.querySelectorAll('.prog-card[data-start]');
      for (const c of cards) {
        if (Number(c.dataset.start) >= now) {
          target = c;
          break;
        }
      }
      if (!target && cards.length) target = cards[cards.length - 1];
    }
    if (!target) return;
    list.querySelectorAll('.prog-card.open').forEach(c => c.classList.remove('open'));
    target.classList.add('open');
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  },

  renderSearchResults(results) {
    const list = document.getElementById('search-results');
    if (!results.length) {
      list.innerHTML = '<div class="empty-state"><p>Ничего не найдено</p></div>';
      return;
    }
    const now = Date.now();
    list.innerHTML = results.map(p => {
      const day = Utils.dayClass(p.start);
      const isNow = p.start <= now && p.stop > now;
      return `
        <div class="prog-card day-${day} ${isNow ? 'now' : ''}" data-channel="${p.channelId}">
          <div class="time">
            ${Utils.formatTime(p.start)} – ${Utils.formatTime(p.stop)}
            <span class="badge ${day}">${Utils.formatDayLabel(p.start)}</span>
            · ${Utils.escapeHtml(p.channelName)}
          </div>
          <div class="title">${Utils.escapeHtml(p.title)}</div>
          ${p.desc ? `<div class="desc">${Utils.escapeHtml(p.desc)}</div>` : ''}
          ${p.category ? `<span class="category">${Utils.escapeHtml(p.category)}</span>` : ''}
        </div>
      `;
    }).join('');
  },

  renderSearchHistory(history) {
    const el = document.getElementById('search-history');
    if (!history.length) { el.innerHTML = ''; return; }
    el.innerHTML = history.map(q =>
      `<button type="button" data-q="${Utils.escapeHtml(q)}">${Utils.escapeHtml(q)}</button>`
    ).join('');
  },

  fillUrlHistory(urls) {
    const dl = document.getElementById('url-history');
    dl.innerHTML = urls.map(u => `<option value="${Utils.escapeHtml(u)}">`).join('');
  }
};
