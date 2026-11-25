const EPG = {
  /**
   * Parse XMLTV and filter by day range.
   * days: 1 = today, 3 = yesterday+today+tomorrow, 7 = wider
   */
  async loadAndParse(url, days = 3, onProgress) {
    if (onProgress) onProgress('Скачивание...');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();

    if (onProgress) onProgress('Распаковка...');
    let xmlText;
    const isGz = url.endsWith('.gz') || (buf.byteLength > 2 && new Uint8Array(buf)[0] === 0x1f && new Uint8Array(buf)[1] === 0x8b);
    if (isGz) {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const stream = new Response(buf).body.pipeThrough(ds);
        xmlText = await new Response(stream).text();
      } else {
        // fallback: try pako if available, else fail
        throw new Error('Браузер не поддерживает распаковку gzip. Обновите браузер.');
      }
    } else {
      xmlText = new TextDecoder().decode(buf);
    }

    if (onProgress) onProgress('Разбор XML...');
    return this.parseXml(xmlText, days);
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
      // 7 days: -2 .. +4
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
    // YYYYMMDDHHmmss +ZZZZ or without
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
