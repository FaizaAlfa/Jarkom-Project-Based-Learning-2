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
  let onlineCountTextEl = null;
  let onlineModalEl = null;
  let closeOnlineModalBtn = null;
  let onlineUsersListEl = null;
  let modalOnlineCountEl = null;
  let typingIndicatorEl = null;
  let typingTextEl = null;

  // Typing tracking state
  let typingTimeout = null;
  let lastTypingSent = 0;
  let remoteTypingTimeout = null;

  // Online users state
  let onlineUsers = [];

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
    onlineCountTextEl = document.getElementById('online-count-text');
    onlineModalEl = document.getElementById('online-users-modal');
    closeOnlineModalBtn = document.getElementById('close-online-modal-btn');
    onlineUsersListEl = document.getElementById('online-users-list');
    modalOnlineCountEl = document.getElementById('modal-online-count');
    typingIndicatorEl = document.getElementById('typing-indicator');
    typingTextEl = document.getElementById('typing-text');

    if (isMockMode) {
      updateOnlineUsersList([
        { username: currentUser.username, client_id: currentUser.clientId },
        { username: 'Rifqi (Bot)', client_id: 'usr_rifqi_bot' }
      ]);
    }

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

    if (chatInputEl) {
      // Deteksi pengetikan secara real-time
      chatInputEl.addEventListener('input', () => {
        const text = chatInputEl.value;
        if (!text.trim()) {
          sendTypingStatus(false);
          return;
        }

        const now = Date.now();
        if (now - lastTypingSent > 1500) {
          sendTypingStatus(true);
          lastTypingSent = now;
        }

        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          sendTypingStatus(false);
        }, 2500);
      });
    }

    if (onlineBadgeEl) {
      onlineBadgeEl.addEventListener('click', (e) => {
        e.preventDefault();
        openOnlineModal();
      });
    }

    if (closeOnlineModalBtn) {
      closeOnlineModalBtn.addEventListener('click', () => {
        closeOnlineModal();
      });
    }

    if (onlineModalEl) {
      onlineModalEl.addEventListener('click', (e) => {
        if (e.target === onlineModalEl) {
          closeOnlineModal();
        }
      });
    }

    // Tutup modal dengan tombol Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && onlineModalEl && !onlineModalEl.classList.contains('hidden')) {
        closeOnlineModal();
      }
    });

    isEventListenersAttached = true;
  }

  function setupSocketListeners() {
    if (!socket) return;

    // Bersihkan listener terdahulu agar tidak duplikasi
    socket.off('receive_chat');
    socket.off('user_typing');
    socket.off('online_users_updated');
    socket.off('connect');
    socket.off('disconnect');

    if (!isMockMode) {
      socket.on('receive_chat', (payload) => {
        renderMessage(payload);
      });

      socket.on('user_typing', (payload) => {
        handleRemoteTyping(payload);
      });

      socket.on('online_users_updated', (data) => {
        if (data && Array.isArray(data.users)) {
          updateOnlineUsersList(data.users);
        }
      });

      socket.on('connect', () => {
        updateTCPStatus(true);
      });

      socket.on('disconnect', () => {
        updateTCPStatus(false);
      });
    }
  }

  function openOnlineModal() {
    if (!onlineModalEl) return;
    renderOnlineUsersListUI();
    onlineModalEl.classList.remove('hidden');
  }

  function closeOnlineModal() {
    if (!onlineModalEl) return;
    onlineModalEl.classList.add('hidden');
  }

  function updateOnlineUsersList(users) {
    onlineUsers = users || [];
    const count = onlineUsers.length;
    if (onlineCountTextEl) {
      onlineCountTextEl.textContent = `${count} Online`;
    }
    if (modalOnlineCountEl) {
      modalOnlineCountEl.textContent = `${count}`;
    }
    renderOnlineUsersListUI();
  }

  function renderOnlineUsersListUI() {
    if (!onlineUsersListEl) return;
    onlineUsersListEl.innerHTML = '';

    if (!onlineUsers || onlineUsers.length === 0) {
      onlineUsersListEl.innerHTML = `
        <div class="py-6 text-center text-xs text-slate-400">
          Belum ada pengguna online.
        </div>
      `;
      return;
    }

    onlineUsers.forEach((user) => {
      const isSelf = user.client_id === currentUser.clientId || user.username === currentUser.username;
      const initial = (user.username || 'U').trim().charAt(0).toUpperCase();
      const userRow = document.createElement('div');
      userRow.className = 'flex items-center justify-between py-2 px-1 hover:bg-slate-50 rounded-lg transition';
      userRow.innerHTML = `
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-brand-100 text-brand-600 font-bold flex items-center justify-center text-xs uppercase shrink-0">
            ${escapeHtml(initial)}
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <span>${escapeHtml(user.username || 'Anonymous')}</span>
              ${isSelf ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 font-medium border border-blue-200">You</span>' : ''}
            </div>
            <div class="text-[11px] text-slate-400">${escapeHtml(user.client_id || '')}</div>
          </div>
        </div>
        <span class="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Aktif
        </span>
      `;
      onlineUsersListEl.appendChild(userRow);
    });
  }

  function sendTypingStatus(isTyping) {
    if (socket && !isMockMode && socket.connected) {
      socket.emit('typing', {
        type: 'typing',
        client_id: currentUser.clientId,
        username: currentUser.username || 'Anonymous',
        is_typing: isTyping
      });
    }
  }

  function handleRemoteTyping(payload) {
    if (!typingIndicatorEl || !typingTextEl) return;
    if (payload.client_id === currentUser.clientId) return;

    if (payload.is_typing) {
      typingTextEl.textContent = `${payload.username || 'Seseorang'} sedang mengetik...`;
      typingIndicatorEl.classList.remove('opacity-0');
      typingIndicatorEl.classList.add('opacity-100');

      if (remoteTypingTimeout) clearTimeout(remoteTypingTimeout);
      remoteTypingTimeout = setTimeout(() => {
        typingIndicatorEl.classList.remove('opacity-100');
        typingIndicatorEl.classList.add('opacity-0');
      }, 3500);
    } else {
      if (remoteTypingTimeout) clearTimeout(remoteTypingTimeout);
      typingIndicatorEl.classList.remove('opacity-100');
      typingIndicatorEl.classList.add('opacity-0');
    }
  }

  function notifyJoin() {
    const payload = {
      type: 'user_join',
      client_id: currentUser.clientId,
      username: currentUser.username || 'Anonymous',
      message: `${currentUser.username || 'Anonymous'} bergabung ke sesi obrolan.`,
      timestamp: Date.now() / 1000
    };

    if (socket && !isMockMode && socket.connected) {
      socket.emit('user_join', payload);
    } else {
      // Mock mode: render langsung
      renderMessage(payload);
    }
  }

  function notifyLeave() {
    const payload = {
      type: 'user_leave',
      client_id: currentUser.clientId,
      username: currentUser.username || 'Anonymous',
      message: `${currentUser.username || 'Anonymous'} meninggalkan sesi obrolan.`,
      timestamp: Date.now() / 1000
    };

    if (socket && !isMockMode && socket.connected) {
      socket.emit('user_leave', payload);
    } else {
      // Mock mode: render langsung dan kurangi daftar
      renderMessage(payload);
      updateOnlineUsersList(onlineUsers.filter(u => u.client_id !== currentUser.clientId));
    }
  }

  function handleSendMessage() {
    if (isSending) return; // Cegah pemanggilan dobel beruntun
    if (!chatInputEl) return;

    const message = chatInputEl.value.trim();
    if (!message) return;

    isSending = true;

    // Hentikan indikator typing saat pesan dikirim
    sendTypingStatus(false);
    if (typingTimeout) clearTimeout(typingTimeout);

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

    // Tampilan Pesan Sistem (User Join & User Leave)
    if (payload.type === 'system' || payload.type === 'user_join' || payload.type === 'user_leave') {
      const timeStr = formatTime(payload.timestamp);
      const isLeave = payload.type === 'user_leave' || (payload.message && payload.message.toLowerCase().includes('meninggalkan'));
      const dotColor = isLeave ? 'bg-rose-500' : 'bg-emerald-500';
      const badgeStyle = isLeave ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-600 border-slate-200';

      const systemWrapper = document.createElement('div');
      systemWrapper.className = 'flex justify-center my-2';
      systemWrapper.innerHTML = `
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${badgeStyle} border shadow-xs">
          <span class="w-1.5 h-1.5 rounded-full ${dotColor} ${isLeave ? '' : 'animate-pulse'}"></span>
          <span>${escapeHtml(payload.message || `${payload.username || 'User'} memperbarui status.`)}</span>
          <span class="text-[10px] opacity-60 ml-1">(${timeStr})</span>
        </div>
      `;
      chatMessagesEl.appendChild(systemWrapper);
      scrollToBottom();
      return;
    }

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
    updateTCPStatus,
    notifyJoin,
    notifyLeave,
    sendTypingStatus,
    updateOnlineUsersList
  };
})();
