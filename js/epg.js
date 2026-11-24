/**
 * EPG fetch + parse (XMLTV)
 * Uses DecompressionStream for .gz when available
 */

async function fetchEpgInfo(url) {
  // First try HEAD for size and last-modified
  let size = null;
  let lastModified = null;

  try {
    const head = await fetch(url, { method: 'HEAD', mode: 'cors' });
    if (head.ok) {
      const cl = head.headers.get('content-length');
      if (cl) size = parseInt(cl, 10);
      const lm = head.headers.get('last-modified');
      if (lm) lastModified = new Date(lm);
    }
  } catch (e) {
    // HEAD may fail due to CORS, continue with GET
  }

  return { size, lastModified, url };
}

/**
 * Download and parse EPG, filtering by day offsets.
 * Returns { channels, programmes, meta }
 */
async function loadEpg(url, period, onProgress) {
  const offsets = getPeriodOffsets(period);
  const now = new Date();
  const dayStarts = offsets.map(o => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o);
    return d.getTime();
  });
  const minTime = Math.min(...dayStarts);
  const maxTime = Math.max(...dayStarts) + 24 * 60 * 60 * 1000;

  onProgress && onProgress('Скачивание файла...');

  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Ошибка загрузки: ${response.status}`);
  }

  let stream = response.body;

  // Decompress .gz if needed
  const isGzip = url.toLowerCase().endsWith('.gz') ||
    (response.headers.get('content-type') || '').includes('gzip');

  if (isGzip && typeof DecompressionStream !== 'undefined') {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }

  onProgress && onProgress('Чтение и разбор XML...');

  // Read as text in chunks and parse with DOMParser at the end
  // For very large files this still uses memory, but filtered later
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let xmlText = '';
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    xmlText += decoder.decode(value, { stream: true });
    if (onProgress && received % (2 * 1024 * 1024) < value.length) {
      onProgress(`Прочитано ${formatBytes(received)}...`);
    }
  }
  xmlText += decoder.decode(); // flush

  onProgress && onProgress('Разбор структуры...');

  // Parse XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Не удалось разобрать XML. Возможно, повреждённый файл.');
  }

  // Extract channels
  const channelMap = new Map(); // id -> channel
  const channelNodes = doc.querySelectorAll('channel');
  channelNodes.forEach(node => {
    const id = node.getAttribute('id');
    if (!id) return;
    if (channelMap.has(id)) return; // keep first

    const displayName = node.querySelector('display-name');
    const icon = node.querySelector('icon');
    channelMap.set(id, {
      id: null, // will be set later with source prefix
      originalId: id,
      name: displayName ? displayName.textContent.trim() : id,
      icon: icon ? icon.getAttribute('src') : null
    });
  });

  // Extract programmes within time range
  const programmes = [];
  const programmeNodes = doc.querySelectorAll('programme');
  let totalInFile = 0;

  programmeNodes.forEach(node => {
    totalInFile++;
    const startStr = node.getAttribute('start');
    const stopStr = node.getAttribute('stop');
    const channelId = node.getAttribute('channel');
    if (!startStr || !channelId) return;

    const start = parseXmltvDate(startStr);
    if (!start) return;
    const startMs = start.getTime();

    // Filter by selected period
    if (startMs < minTime || startMs >= maxTime) return;

    const stop = stopStr ? parseXmltvDate(stopStr) : null;
    const titleNode = node.querySelector('title');
    const descNode = node.querySelector('desc');
    const catNode = node.querySelector('category');

    programmes.push({
      id: null, // filled later
      channelId: null, // filled later
      originalChannelId: channelId,
      start: startMs,
      stop: stop ? stop.getTime() : null,
      title: titleNode ? titleNode.textContent.trim() : 'Без названия',
      desc: descNode ? descNode.textContent.trim() : '',
      category: catNode ? catNode.textContent.trim() : ''
    });
  });

  // Build meta
  const dates = [];
  programmeNodes.forEach(node => {
    const s = node.getAttribute('start');
    if (s && s.length >= 8) dates.push(s.slice(0, 8));
  });
  const uniqueDays = [...new Set(dates)].sort();

  const meta = {
    channelCount: channelMap.size,
    programmeCountInFile: totalInFile,
    programmeCountLoaded: programmes.length,
    dateFrom: uniqueDays[0] || null,
    dateTo: uniqueDays[uniqueDays.length - 1] || null,
    generator: null
  };

  const tvNode = doc.querySelector('tv');
  if (tvNode) {
    meta.generator = tvNode.getAttribute('generator-info-name') ||
                     tvNode.getAttribute('generator-info-url') || null;
  }

  return {
    channels: Array.from(channelMap.values()),
    programmes,
    meta
  };
}

/**
 * Lightweight analysis: download full file but only extract stats
 * (for the "analyze" step before choosing period)
 */
async function analyzeEpg(url, onProgress) {
  onProgress && onProgress('Скачивание для анализа...');

  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`Ошибка: ${response.status}`);

  let stream = response.body;
  const isGzip = url.toLowerCase().endsWith('.gz') ||
    (response.headers.get('content-type') || '').includes('gzip');

  if (isGzip && typeof DecompressionStream !== 'undefined') {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let xmlText = '';
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    xmlText += decoder.decode(value, { stream: true });
    if (onProgress && received % (3 * 1024 * 1024) < value.length) {
      onProgress(`Анализ: ${formatBytes(received)}...`);
    }
  }
  xmlText += decoder.decode();

  onProgress && onProgress('Подсчёт данных...');

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Не удалось разобрать XML');
  }

  const channels = new Set();
  doc.querySelectorAll('channel').forEach(n => {
    const id = n.getAttribute('id');
    if (id) channels.add(id);
  });

  const dates = new Set();
  let progCount = 0;
  doc.querySelectorAll('programme').forEach(n => {
    progCount++;
    const s = n.getAttribute('start');
    if (s && s.length >= 8) dates.add(s.slice(0, 8));
  });

  const sortedDays = [...dates].sort();
  const tvNode = doc.querySelector('tv');

  // Approximate uncompressed size
  const uncompressedApprox = xmlText.length;

  return {
    sizeCompressed: received, // after download we know real size roughly
    sizeUncompressed: uncompressedApprox,
    channelCount: channels.size,
    programmeCount: progCount,
    dateFrom: sortedDays[0] || null,
    dateTo: sortedDays[sortedDays.length - 1] || null,
    dayCount: sortedDays.length,
    generator: tvNode ?
      (tvNode.getAttribute('generator-info-name') || tvNode.getAttribute('generator-info-url')) : null,
    lastModified: null // filled from HEAD if available
  };
}
