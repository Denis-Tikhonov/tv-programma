const Utils = {
  formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  formatTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  formatDayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const diff = (day - today) / 86400000;
    if (diff === 0) return 'Сегодня';
    if (diff === -1) return 'Вчера';
    if (diff === 1) return 'Завтра';
    return this.formatDate(ts).slice(0, 10);
  },

  dayClass(ts) {
    const d = new Date(ts);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const diff = (day - today) / 86400000;
    if (diff === 0) return 'today';
    if (diff === -1) return 'yesterday';
    if (diff === 1) return 'tomorrow';
    return '';
  },

  freshness(ts) {
    if (!ts) return { text: 'не загружен', cls: 'old' };
    const now = Date.now();
    const diff = now - ts;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return { text: 'сегодня', cls: 'today' };
    if (days === 1) return { text: 'вчера', cls: 'yesterday' };
    return { text: `${days} дн. назад`, cls: 'old' };
  },

  toast(msg, ms = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  },

  showLoading(text = 'Загрузка...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').classList.remove('hidden');
  },

  hideLoading() {
    document.getElementById('loading').classList.add('hidden');
  },

  debounce(fn, wait = 350) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};
