/**
 * Utility helpers
 */

function formatBytes(bytes) {
  if (bytes === 0) return '0 Б';
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(date) {
  if (!date) return '—';
  const d = (date instanceof Date) ? date : new Date(date);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatTime(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateTime(date) {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** Parse XMLTV datetime string like "20261124120000 +0300" */
function parseXmltvDate(str) {
  if (!str || str.length < 14) return null;
  const y = str.slice(0, 4);
  const m = str.slice(4, 6);
  const d = str.slice(6, 8);
  const h = str.slice(8, 10);
  const min = str.slice(10, 12);
  const s = str.slice(12, 14);
  // Ignore timezone for simplicity (most EPGs are local)
  return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
}

function getDayBounds(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1);
  return { start, end };
}

/** Returns array of day offsets based on period choice */
function getPeriodOffsets(period) {
  // period: '1' | '3' | '7'
  if (period === '1') return [0];                    // today
  if (period === '3') return [-1, 0, 1];              // yesterday, today, tomorrow
  if (period === '7') return [-2, -1, 0, 1, 2, 3, 4]; // 7 days
  return [-1, 0, 1];
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function showToast(message, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.classList.add('hidden');
  }, duration);
}

function showLoading(text = 'Загрузка...') {
  const el = document.getElementById('loading');
  const textEl = document.getElementById('loading-text');
  if (textEl) textEl.textContent = text;
  if (el) el.classList.remove('hidden');
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Simple unique id */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
