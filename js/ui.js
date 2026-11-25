const UI = {
  currentView: 'home',
  favoritesOnly: false,
  channelFilter: '',

  showView(name) {
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
    document.getElementById('header-title').textContent = titles[name] || 'ТВ программа';
  },

  openMenu() {
    document.getElementById('side-menu').classList.add('open');
    document.getElementById('menu-overlay').classList.add('open');
  },

  closeMenu() {
    document.getElementById('side-menu').classList.remove('open');
    document.getElementById('menu-overlay').classList.remove('open');
  },

  renderSources(presets, savedSources, activeId) {
    const container = document.getElementById('sources-list');
    const all = [...presets];

    // merge saved custom
    savedSources.forEach(s => {
      if (!all.find(p => p.id === s.id)) all.push(s);
    });

    container.innerHTML = all.map(s => {
      const isActive = s.id === activeId;
      const loaded = s.loadedAt;
      const fresh = Utils.freshness(loaded);
      const statusText = loaded
        ? `Загружено: ${Utils.formatDate(loaded)} · ${s.channelCount || 0} каналов`
        : 'Не загружен';

      return `
        <div class="source-card ${isActive ? 'active' : ''}" data-id="${s.id}">
          <div class="top">
            <div>
              <div class="name">${Utils.escapeHtml(s.name)}</div>
              <div class="status">${statusText}</div>
              ${loaded ? `<div class="fresh"><span class="dot ${fresh.cls}"></span> ${fresh.text}</div>` : ''}
            </div>
          </div>
          <div class="actions">
            ${isActive
              ? `<button class="btn primary btn-open-channels" data-id="${s.id}">Каналы</button>`
              : `<button class="btn btn-activate" data-id="${s.id}">Выбрать</button>`
            }
            <button class="btn btn-reload" data-id="${s.id}">${loaded ? 'Обновить' : 'Загрузить'}</button>
          </div>
        </div>
      `;
    }).join('');
  },

  renderChannels(channels, favorites, filter = '', favOnly = false) {
    const list = document.getElementById('channels-list');
    let items = channels;
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

    list.innerHTML = items.map(c => `
      <div class="list-item" data-id="${c.id}">
        <img class="icon" src="${c.icon || ''}" alt="" onerror="this.style.display='none'">
        <div class="info">
          <div class="name">${Utils.escapeHtml(c.name)}</div>
        </div>
        <button class="fav ${favorites.has(c.id) ? 'active' : ''}" data-id="${c.id}">★</button>
      </div>
    `).join('');
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
    const header = document.getElementById('programmes-header');
    header.innerHTML = `
      <div class="ch-name">${Utils.escapeHtml(channelName)}</div>
      <div class="ch-meta">${programmes.length} передач</div>
    `;

    const list = document.getElementById('programmes-list');
    const now = Date.now();
    let nowIndex = -1;

    list.innerHTML = programmes.map((p, i) => {
      const day = Utils.dayClass(p.start);
      const isNow = p.start <= now && p.stop > now;
      if (isNow) nowIndex = i;
      const badge = Utils.formatDayLabel(p.start);
      return `
        <div class="prog-card day-${day} ${isNow ? 'now' : ''}" data-start="${p.start}">
          <div class="time">
            ${Utils.formatTime(p.start)} – ${Utils.formatTime(p.stop)}
            <span class="badge ${day}">${badge}</span>
          </div>
          <div class="title">${Utils.escapeHtml(p.title)}</div>
          ${p.desc ? `<div class="desc">${Utils.escapeHtml(p.desc)}</div>` : ''}
          ${p.category ? `<span class="category">${Utils.escapeHtml(p.category)}</span>` : ''}
        </div>
      `;
    }).join('');

    // scroll to current
    requestAnimationFrame(() => {
      const target = list.querySelector('.prog-card.now') || list.querySelector(`[data-start]`);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    });
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
    if (!history.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = history.map(q =>
      `<button type="button" data-q="${Utils.escapeHtml(q)}">${Utils.escapeHtml(q)}</button>`
    ).join('');
  },

  fillUrlHistory(urls) {
    const dl = document.getElementById('url-history');
    dl.innerHTML = urls.map(u => `<option value="${Utils.escapeHtml(u)}">`).join('');
  }
};
