/**
 * UI rendering helpers
 */

const UI = {
  main: null,

  init() {
    this.main = document.getElementById('main');
  },

  clear() {
    this.main.innerHTML = '';
  },

  render(html) {
    this.main.innerHTML = html;
  },

  // ---------- Sources screen ----------
  renderSources(sources, activeId) {
    let listHtml = '';

    if (!sources.length) {
      listHtml = `<div class="empty-state"><p>Нет источников</p></div>`;
    } else {
      listHtml = sources.map(s => {
        const isActive = s.id === activeId;
        const status = s.loaded
          ? `${s.meta?.channelCount || '?'} каналов`
          : 'не загружен';

        let actions = '';
        if (s.loaded) {
          if (!isActive) {
            actions += `<button class="btn btn-select-source" data-id="${s.id}">Выбрать</button>`;
          }
        } else {
          actions += `<button class="btn btn-primary btn-load-source" data-id="${s.id}">Загрузить</button>`;
        }

        // Удалять можно только пользовательские источники
        if (!s.isPreset) {
          actions += `<button class="btn btn-danger btn-delete-source" data-id="${s.id}" title="Удалить">✕</button>`;
        }

        return `
          <div class="card source-item" data-id="${s.id}">
            <div class="source-info">
              <div class="source-name">
                ${escapeHtml(s.name || s.url)}
                ${isActive ? '<span class="badge badge-active">активный</span>' : ''}
                ${s.isPreset ? '<span class="badge" style="background:rgba(63,185,80,0.15);color:var(--success)">предустановленный</span>' : ''}
              </div>
              <div class="source-meta">
                ${s.description ? escapeHtml(s.description) + ' · ' : ''}${status}
              </div>
            </div>
            <div class="source-actions">
              ${actions}
            </div>
          </div>
        `;
      }).join('');
    }

    this.render(`
      <div class="screen">
        <h2 class="screen-title">Источники EPG</h2>
        ${listHtml}

        <div class="mt-16">
          <label class="label">Добавить свой источник (URL)</label>
          <input type="url" id="input-url" class="input" placeholder="https://example.com/epg.xml.gz">
          <button id="btn-add-source" class="btn btn-primary btn-block mt-8">Добавить и проанализировать</button>
        </div>
        <div id="analyze-result" class="hidden"></div>
      </div>
    `);
  },

  /** Упрощённый выбор периода (для предустановленных источников) */
  renderPeriodSelect(source) {
    this.render(`
      <div class="screen">
        <h2 class="screen-title">Загрузка: ${escapeHtml(source.name)}</h2>
        <p class="muted mb-16">${escapeHtml(source.description || source.url)}</p>

        <p class="muted mb-8">Выберите период:</p>
        <div class="period-options">
          <label class="period-option">
            <input type="radio" name="period" value="1">
            <div>
              <strong>Только сегодня</strong>
              <div class="small muted">Минимум данных</div>
            </div>
          </label>
          <label class="period-option selected">
            <input type="radio" name="period" value="3" checked>
            <div>
              <strong>Вчера + сегодня + завтра</strong>
              <div class="small muted">Рекомендуется</div>
            </div>
          </label>
          <label class="period-option">
            <input type="radio" name="period" value="7">
            <div>
              <strong>7 дней</strong>
              <div class="small muted">Позавчера … +4 дня вперёд</div>
            </div>
          </label>
        </div>

        <button id="btn-load-epg" class="btn btn-primary btn-block mt-16">
          Загрузить
        </button>
        <button id="btn-cancel-load" class="btn btn-block mt-8">Отмена</button>
      </div>
    `);

    // Подсветка выбора периода
    document.querySelectorAll('.period-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.period-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
      });
    });

    const cancel = document.getElementById('btn-cancel-load');
    if (cancel) {
      cancel.addEventListener('click', () => {
        // Вернуться к списку источников — вызывается снаружи через App
        if (window.App && window.App.showSources) window.App.showSources();
      });
    }
  },


  renderAnalyzeResult(info, url) {
    const container = document.getElementById('analyze-result');
    if (!container) return;

    const dateFrom = info.dateFrom ?
      `${info.dateFrom.slice(6, 8)}.${info.dateFrom.slice(4, 6)}.${info.dateFrom.slice(0, 4)}` : '—';
    const dateTo = info.dateTo ?
      `${info.dateTo.slice(6, 8)}.${info.dateTo.slice(4, 6)}.${info.dateTo.slice(0, 4)}` : '—';

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="info-box mt-16">
        <dl>
          <dt>Размер (сжатый)</dt>
          <dd>${formatBytes(info.sizeCompressed || 0)}</dd>
          <dt>Размер (примерно после распаковки)</dt>
          <dd>${formatBytes(info.sizeUncompressed || 0)}</dd>
          <dt>Каналов</dt>
          <dd>${info.channelCount || '—'}</dd>
          <dt>Передач в файле</dt>
          <dd>${(info.programmeCount || 0).toLocaleString('ru-RU')}</dd>
          <dt>Период в архиве</dt>
          <dd>${dateFrom} — ${dateTo} (${info.dayCount || '?'} дн.)</dd>
          ${info.generator ? `<dt>Генератор</dt><dd>${escapeHtml(info.generator)}</dd>` : ''}
          ${info.lastModified ? `<dt>Обновлён</dt><dd>${formatDateTime(info.lastModified)}</dd>` : ''}
        </dl>
      </div>

      <p class="muted mt-16 mb-8">Выберите период для загрузки:</p>
      <div class="period-options">
        <label class="period-option">
          <input type="radio" name="period" value="1">
          <div>
            <strong>Только сегодня</strong>
            <div class="small muted">Минимум данных</div>
          </div>
        </label>
        <label class="period-option selected">
          <input type="radio" name="period" value="3" checked>
          <div>
            <strong>Вчера + сегодня + завтра</strong>
            <div class="small muted">Рекомендуется</div>
          </div>
        </label>
        <label class="period-option">
          <input type="radio" name="period" value="7">
          <div>
            <strong>7 дней</strong>
            <div class="small muted">Позавчера … +4 дня вперёд</div>
          </div>
        </label>
      </div>

      <button id="btn-load-epg" class="btn btn-primary btn-block" data-url="${escapeHtml(url)}">
        Загрузить выбранный период
      </button>
    `;

    // Highlight selected period option
    container.querySelectorAll('.period-option').forEach(opt => {
      opt.addEventListener('click', () => {
        container.querySelectorAll('.period-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
      });
    });
  },

  // ---------- Channels screen ----------
  renderChannels(channels, favorites, activeSourceName) {
    if (!channels.length) {
      this.render(`
        <div class="screen">
          <div class="empty-state">
            <p>Нет каналов</p>
            <p class="small">Загрузите EPG из раздела «Источники»</p>
          </div>
        </div>
      `);
      return;
    }

    // Sort: favorites first, then by user order / name
    const favSet = new Set(favorites);
    const sorted = [...channels].sort((a, b) => {
      const af = favSet.has(a.id) ? 0 : 1;
      const bf = favSet.has(b.id) ? 0 : 1;
      if (af !== bf) return af - bf;
      return (a.name || '').localeCompare(b.name || '', 'ru');
    });

    const list = sorted.map(ch => {
      const isFav = favSet.has(ch.id);
      const iconHtml = ch.icon
        ? `<img class="channel-icon" src="${escapeHtml(ch.icon)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="channel-icon-placeholder">📺</div>`;

      return `
        <div class="channel-item" data-id="${ch.id}">
          ${iconHtml}
          <div class="channel-name">${escapeHtml(ch.name)}</div>
          <button class="fav-btn ${isFav ? 'active' : ''}" data-id="${ch.id}" title="Избранное">
            ${isFav ? '★' : '☆'}
          </button>
        </div>
      `;
    }).join('');

    this.render(`
      <div class="screen" style="padding:0">
        <div style="padding:12px 16px; border-bottom:1px solid var(--border);">
          <div class="muted small">${escapeHtml(activeSourceName || '')}</div>
          <div style="font-weight:500">${channels.length} каналов</div>
        </div>
        ${list}
      </div>
    `);
  },

  // ---------- Programme screen ----------
  renderProgrammes(channel, programmes) {
    const now = Date.now();
    let list = '';

    if (!programmes.length) {
      list = `<div class="empty-state"><p>Нет передач на выбранный период</p></div>`;
    } else {
      list = programmes.map(p => {
        const isCurrent = p.start <= now && (!p.stop || p.stop > now);
        const timeStr = formatTime(new Date(p.start)) +
          (p.stop ? ' – ' + formatTime(new Date(p.stop)) : '');
        return `
          <div class="programme-item ${isCurrent ? 'current' : ''}">
            <div class="programme-time">${timeStr}${isCurrent ? ' · сейчас' : ''}</div>
            <div class="programme-title">${escapeHtml(p.title)}</div>
            ${p.desc ? `<div class="programme-desc">${escapeHtml(p.desc)}</div>` : ''}
            ${p.category ? `<div class="small muted mt-8">${escapeHtml(p.category)}</div>` : ''}
          </div>
        `;
      }).join('');
    }

    this.render(`
      <div class="screen" style="padding:0">
        <div style="padding:12px 16px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:2;">
          <button id="btn-back-channels" class="btn" style="margin-bottom:8px">← Назад</button>
          <div style="font-weight:600; font-size:1.1rem">${escapeHtml(channel.name)}</div>
        </div>
        ${list}
      </div>
    `);

    // Scroll to current programme
    setTimeout(() => {
      const current = this.main.querySelector('.programme-item.current');
      if (current) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  },

  // ---------- Search screen ----------
  renderSearch(results, channelsMap) {
    let list = '';
    if (!results || !results.length) {
      list = `<div class="empty-state"><p>Ничего не найдено</p></div>`;
    } else {
      list = results.map(p => {
        const ch = channelsMap.get(p.channelId);
        const chName = ch ? ch.name : p.originalChannelId;
        const timeStr = formatTime(new Date(p.start));
        return `
          <div class="card" data-channel-id="${p.channelId}">
            <div class="muted small">${escapeHtml(chName)} · ${timeStr}</div>
            <div style="font-weight:500; margin-top:4px">${escapeHtml(p.title)}</div>
            ${p.desc ? `<div class="programme-desc mt-8">${escapeHtml(p.desc)}</div>` : ''}
          </div>
        `;
      }).join('');
    }

    this.render(`
      <div class="screen" style="padding:0">
        <div class="search-box">
          <input type="search" id="search-input" class="input" placeholder="Название, жанр, страна..." autofocus>
        </div>
        <div class="search-results" style="padding:8px 16px">
          ${list}
        </div>
      </div>
    `);
  }
};
