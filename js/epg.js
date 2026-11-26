const EPG = {
  async loadAndParse(url, days = 3, onProgress) {
    const report = (text, pct) => {
      if (onProgress) onProgress(text, pct);
    };

    report('Скачивание...', 0);

    // cache-bust so update always gets fresh file
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const resp = await fetch(fetchUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — файл недоступен`);

    const total = Number(resp.headers.get('Content-Length')) || 0;
    let buf;

    if (resp.body && typeof resp.body.getReader === 'function' && total > 0) {
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const pct = Math.min(90, Math.round((received / total) * 85));
        report(`Скачивание... ${this._fmtSize(received)} / ${this._fmtSize(total)}`, pct);
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      buf = merged.buffer;
    } else {
      buf = await resp.arrayBuffer();
      report('Скачивание завершено', 85);
    }

    report('Распаковка...', 88);
    let xmlText;
    const u8 = new Uint8Array(buf);
    const isGz = url.includes('.gz') || (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b);
    if (isGz) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Браузер не поддерживает gzip. Обновите Chrome / Safari.');
      }
      const ds = new DecompressionStream('gzip');
      const stream = new Response(buf).body.pipeThrough(ds);
      xmlText = await new Response(stream).text();
    } else {
      xmlText = new TextDecoder().decode(buf);
    }

    report('Разбор XML...', 93);
    const result = this.parseXml(xmlText, days);
    report('Сохранение...', 97);
    return result;
  },

  _fmtSize(n) {
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' КБ';
    return (n / 1048576).toFixed(1) + ' МБ';
  },

  parseXml(xmlText, days) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Ошибка разбора XML');
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let rangeStart, rangeEnd;

    if (days === 1) {
      rangeStart = startOfToday;
      rangeEnd = startOfToday + 86400000;
    } else if (days === 3) {
      rangeStart = startOfToday - 86400000;
      rangeEnd = startOfToday + 2 * 86400000;
    } else {
      rangeStart = startOfToday - 2 * 86400000;
      rangeEnd = startOfToday + 5 * 86400000;
    }

    const channels = [];
    const channelMap = new Map();

    doc.querySelectorAll('channel').forEach(ch => {
      const id = ch.getAttribute('id');
      if (!id || channelMap.has(id)) return;
      const nameEl = ch.querySelector('display-name');
      const iconEl = ch.querySelector('icon');
      const name = nameEl ? nameEl.textContent.trim() : id;
      const icon = iconEl ? iconEl.getAttribute('src') : null;
      const channel = { id, name, icon };
      channels.push(channel);
      channelMap.set(id, channel);
    });

    const programmes = [];
    doc.querySelectorAll('programme').forEach(pr => {
      const chId = pr.getAttribute('channel');
      const startStr = pr.getAttribute('start');
      const stopStr = pr.getAttribute('stop');
      if (!chId || !startStr) return;

      const start = this.parseXmlTime(startStr);
      const stop = stopStr ? this.parseXmlTime(stopStr) : start + 3600000;
      if (start < rangeStart || start >= rangeEnd) return;

      const titleEl = pr.querySelector('title');
      const descEl = pr.querySelector('desc');
      const catEl = pr.querySelector('category');
      const chInfo = channelMap.get(chId);

      programmes.push({
        uid: `${chId}_${start}`,
        channelId: chId,
        channelName: chInfo ? chInfo.name : chId,
        start,
        stop,
        title: titleEl ? titleEl.textContent.trim() : 'Без названия',
        desc: descEl ? descEl.textContent.trim() : '',
        category: catEl ? catEl.textContent.trim() : ''
      });
    });

    return {
      channels,
      programmes,
      stats: {
        channels: channels.length,
        programmes: programmes.length,
        rangeStart,
        rangeEnd
      }
    };
  },

  parseXmlTime(str) {
    const m = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
    if (!m) return 0;
    const [, y, mo, d, h, mi, s, tz] = m;
    let date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    if (tz) {
      const sign = tz[0] === '-' ? -1 : 1;
      const th = parseInt(tz.slice(1, 3), 10);
      const tm = parseInt(tz.slice(3, 5), 10);
      date = new Date(date.getTime() - sign * (th * 60 + tm) * 60000);
    }
    return date.getTime();
  }
};
