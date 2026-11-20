// Minimal Telegram Bot API client (long polling, no webhook, no dependencies).
const MAX = 4000; // Telegram limit is 4096 characters per message

export class Telegram {
  constructor(token, { base = 'https://api.telegram.org' } = {}) {
    this.url = `${base}/bot${token}`;
    this.fileUrl = `${base}/file/bot${token}`;
  }

  async call(method, body = {}, timeoutMs = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        const err = new Error(`Telegram ${method}: ${data.description ?? res.status}`);
        err.code = data.error_code ?? res.status;
        throw err;
      }
      return data.result;
    } catch (e) {
      if (e.name === 'AbortError' || e.cause || e.message === 'fetch failed') e.network = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  getUpdates(offset, timeout = 50) {
    return this.call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query', 'channel_post'] }, (timeout + 15) * 1000);
  }

  // Plain text only (no Markdown), split into several messages when long.
  async send(chatId, text, extra = {}) {
    const parts = splitText(String(text || '…'));
    let last;
    for (let i = 0; i < parts.length; i++) {
      last = await this.call('sendMessage', {
        chat_id: chatId, text: parts[i], disable_web_page_preview: true, ...(i === parts.length - 1 ? extra : {}),
      });
    }
    return last;
  }

  // Photo by URL (Telegram downloads it). Falls back to text if the picture cannot be used.
  async sendPhotoUrl(chatId, url, caption = '') {
    if (url) {
      try { return await this.call('sendPhoto', { chat_id: chatId, photo: url, caption: caption.slice(0, 1024) }, 40000); } catch { /* bad picture */ }
    }
    return this.send(chatId, caption, { disable_web_page_preview: false });
  }

  async sendPhoto(chatId, png, caption = '') {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption.slice(0, 1024));
    form.append('photo', new Blob([png], { type: 'image/png' }), 'chart.png');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(`${this.url}/sendPhoto`, { method: 'POST', body: form, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(`Telegram sendPhoto: ${data.description ?? res.status}`);
      return data.result;
    } finally { clearTimeout(timer); }
  }

  uploading(chatId) { return this.call('sendChatAction', { chat_id: chatId, action: 'upload_photo' }).catch(() => {}); }

  typing(chatId) { return this.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}); }

  async downloadFile(fileId, maxBytes = 5_000_000) {
    const f = await this.call('getFile', { file_id: fileId });
    if (f.file_size > maxBytes) throw new Error('File too large');
    const res = await fetch(`${this.fileUrl}/${f.file_path}`);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), path: f.file_path };
  }
}

export function splitText(text) {
  const out = [];
  let rest = text;
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf('\n', MAX);
    if (cut < MAX / 2) cut = rest.lastIndexOf(' ', MAX);
    if (cut < MAX / 2) cut = MAX;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) out.push(rest);
  return out;
}
