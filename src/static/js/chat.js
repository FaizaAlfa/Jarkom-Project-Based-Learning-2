/**
 * chat.js - TCP Chat Logic & Client Event Handler
 * Menangani pengiriman pesan chat via TCP Sock Stream (Flask-SocketIO Bridge)
 */

window.ChatManager = (function() {
  let socket = null;
  let currentUser = {
    username: '',
    clientId: 'usr_node_01'
  };
  let isMockMode = true;
  let isEventListenersAttached = false;
  let isSending = false; // Guard untuk mencegah double sending

  // DOM Elements
  let chatMessagesEl = null;
  let chatInputEl = null;
  let chatFormEl = null;
  let tcpStatusBadgeEl = null;
  let onlineBadgeEl = null;

  function init(options) {
    if (options && options.user) {
      currentUser = options.user;
    }
    socket = options && options.socket ? options.socket : null;
    isMockMode = options && typeof options.isMockMode === 'boolean' ? options.isMockMode : true;

    chatMessagesEl = document.getElementById('chat-messages');
    chatInputEl = document.getElementById('chat-input');
    chatFormEl = document.getElementById('chat-form');
    tcpStatusBadgeEl = document.getElementById('tcp-status-badge');
    onlineBadgeEl = document.getElementById('online-badge');

    setupEventListeners();
    setupSocketListeners();
  }

  function setSocket(sockInstance, mockState) {
    socket = sockInstance;
    isMockMode = mockState;
    setupSocketListeners();
  }

  function updateUser(user) {
    currentUser = user;
  }

  function setupEventListeners() {
    if (isEventListenersAttached) return; // Mencegah listener ganda

    if (chatFormEl) {
      // Menggunakan satu form submit listener untuk Enter key & klik tombol Send
      chatFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSendMessage();
      });
    }

    isEventListenersAttached = true;
  }

  function setupSocketListeners() {
    if (!socket) return;

    // Bersihkan listener terdahulu agar tidak duplikasi
    socket.off('receive_chat');
    socket.off('connect');
    socket.off('disconnect');

    if (!isMockMode) {
      socket.on('receive_chat', (payload) => {
        renderMessage(payload);
      });

      socket.on('connect', () => {
        updateTCPStatus(true);
      });

      socket.on('disconnect', () => {
        updateTCPStatus(false);
      });
    }
  }

  function handleSendMessage() {
    if (isSending) return; // Cegah pemanggilan dobel beruntun
    if (!chatInputEl) return;

    const message = chatInputEl.value.trim();
    if (!message) return;

    isSending = true;

    // Sesuai format PRD alur.md bagian 2.3 A (Payload Pesan Chat TCP)
    const payload = {
      type: 'chat_message',
      client_id: currentUser.clientId,
      username: currentUser.username || 'Anonymous',
      message: message,
      timestamp: Date.now() / 1000
    };

    if (socket && !isMockMode && socket.connected) {
      // Kirim event TCP via Flask-SocketIO Bridge
      socket.emit('send_chat', payload);
    } else {
      // Mock / Loopback Simulation Mode: render lokal sekali saja
      renderMessage(payload);
    }

    chatInputEl.value = '';
    chatInputEl.focus();

    // Reset lock setelah 250ms
    setTimeout(() => {
      isSending = false;
    }, 250);
  }

  function formatTime(timestamp) {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function renderMessage(payload) {
    if (!chatMessagesEl) return;

    const isSelf = payload.client_id === currentUser.clientId || payload.username === currentUser.username;
    const timeStr = formatTime(payload.timestamp);

    const messageWrapper = document.createElement('div');
    messageWrapper.className = `flex flex-col ${isSelf ? 'items-end' : 'items-start'} mb-3`;

    if (isSelf) {
      // Tampilan chat pengirim sendiri (Biru muda, nama & jam di kanan atas)
      messageWrapper.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs text-gray-400 font-normal">${timeStr}</span>
          <span class="text-xs font-semibold text-gray-800">${escapeHtml(payload.username)}</span>
        </div>
        <div class="bg-blue-100 text-gray-900 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%] break-words shadow-sm">
          ${escapeHtml(payload.message)}
        </div>
      `;
    } else {
      // Tampilan chat pengirim lain (Abu-abu, nama & jam di kiri atas)
      messageWrapper.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs font-semibold text-gray-800">${escapeHtml(payload.username)}</span>
          <span class="text-xs text-gray-400 font-normal">${timeStr}</span>
        </div>
        <div class="bg-slate-100 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] break-words shadow-sm">
          ${escapeHtml(payload.message)}
        </div>
      `;
    }

    chatMessagesEl.appendChild(messageWrapper);
    scrollToBottom();
  }

  function scrollToBottom() {
    if (chatMessagesEl) {
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
  }

  function updateTCPStatus(connected) {
    if (!tcpStatusBadgeEl) return;
    if (connected) {
      tcpStatusBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
      tcpStatusBadgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> TCP Chat (Port 5000): Connected`;
    } else {
      tcpStatusBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200';
      tcpStatusBadgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> TCP Chat: Disconnected (Mock Mode)`;
    }
  }

  function escapeHtml(string) {
    const div = document.createElement('div');
    div.textContent = string;
    return div.innerHTML;
  }

  return {
    init,
    setSocket,
    updateUser,
    renderMessage,
    updateTCPStatus
  };
})();
