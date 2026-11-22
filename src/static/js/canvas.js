/**
 * canvas.js - UDP Canvas Drawing Logic & Socket.IO Remote Pointer
 * Menangani streaming data live canvas drawing via UDP Datagram (Flask-SocketIO Bridge)
 * dan remote cursor via Socket.IO.
 */

window.CanvasManager = (function() {
  let socket = null;
  let currentUser = {
    username: 'Faiza',
    clientId: 'usr_node_01'
  };
  let isMockMode = true;

  // Canvas DOM & Context
  let canvasContainer = null;
  let canvas = null;
  let ctx = null;

  // Drawing State
  let isDrawing = false;
  let currentColor = '#EF4444'; // Default sesuai screenshot desain (merah)
  let currentSize = 5;          // Default sesuai screenshot desain (5px)
  let prevPos = { x: 0, y: 0 };
  let strokeCounter = 1000;

  // Remote cursors container
  let remoteCursorsContainer = null;
  const remoteCursors = {};

  // Status badge
  let udpStatusBadgeEl = null;
  let isInitialized = false;

  function init(options) {
    if (options && options.user) {
      currentUser = options.user;
    }
    socket = options && options.socket ? options.socket : null;
    isMockMode = options && typeof options.isMockMode === 'boolean' ? options.isMockMode : true;

    canvasContainer = document.getElementById('canvas-container');
    canvas = document.getElementById('whiteboard-canvas');
    if (!canvas) return;

    ctx = canvas.getContext('2d');
    remoteCursorsContainer = document.getElementById('remote-cursors-layer');
    udpStatusBadgeEl = document.getElementById('udp-status-badge');

    setupCanvasSize();

    if (!isInitialized) {
      window.addEventListener('resize', handleResize);
      setupDrawingEvents();
      setupToolbar();
      isInitialized = true;
    }

    setupSocketListeners();

    // Mode kursor remote sementara dinonaktifkan sesuai kebutuhan
    // if (isMockMode) {
    //   initMockSimulation();
    // }
  }

  function setSocket(sockInstance, mockState) {
    socket = sockInstance;
    isMockMode = mockState;
    setupSocketListeners();
  }

  function updateUser(user) {
    currentUser = user;
  }

  function setupCanvasSize() {
    if (!canvasContainer || !canvas) return;

    // Simpan konten saat resize agar tidak hilang
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (canvas.width > 0 && canvas.height > 0) {
      tempCtx.drawImage(canvas, 0, 0);
    }

    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Pulihkan konten
    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
      ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width / dpr, tempCanvas.height / dpr);
    }
  }

  function handleResize() {
    setupCanvasSize();
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
      x: Math.round(clientX - rect.left),
      y: Math.round(clientY - rect.top)
    };
  }

  function setupDrawingEvents() {
    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', () => {
      // Hanya berhenti jika mouse keluar
      if (isDrawing) stopDrawing();
    });

    // Touch events untuk mobile/tablet
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDrawing(e);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      draw(e);
    }, { passive: false });

    window.addEventListener('touchend', stopDrawing);
  }

  function startDrawing(e) {
    isDrawing = true;
    const pos = getCanvasCoords(e);
    prevPos = { x: pos.x, y: pos.y };

    // Gambar titik awal
    drawLine(pos.x, pos.y, pos.x, pos.y, currentColor, currentSize);

    // Kirim stroke pertama
    sendStroke(pos.x, pos.y, pos.x, pos.y);
  }

  function draw(e) {
    const pos = getCanvasCoords(e);

    // Kursor remote dinonaktifkan sementara
    // sendCursorPosition(pos.x, pos.y);

    if (!isDrawing) return;

    // Gambar lokal
    drawLine(prevPos.x, prevPos.y, pos.x, pos.y, currentColor, currentSize);

    // Kirim via UDP event
    sendStroke(pos.x, pos.y, prevPos.x, prevPos.y);

    prevPos = { x: pos.x, y: pos.y };
  }

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
  }

  function drawLine(fromX, fromY, toX, toY, color, size) {
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  function sendStroke(x, y, prev_x, prev_y) {
    strokeCounter++;

    // Sesuai format PRD alur.md bagian 2.3 B (Payload Stroke Canvas UDP)
    const payload = {
      type: 'draw_stroke',
      client_id: currentUser.clientId,
      stroke_id: strokeCounter,
      x: x,
      y: y,
      prev_x: prev_x,
      prev_y: prev_y,
      color: currentColor,
      size: currentSize,
      timestamp: Date.now() / 1000
    };

    if (socket && !isMockMode && socket.connected) {
      socket.emit('draw_stroke', payload);
    }
  }

  function sendCursorPosition(x, y) {
    const cursorPayload = {
      type: 'cursor_move',
      client_id: currentUser.clientId,
      username: currentUser.username,
      x: x,
      y: y,
      timestamp: Date.now() / 1000
    };

    if (socket && !isMockMode && socket.connected) {
      socket.emit('cursor_move', cursorPayload);
    }
  }

  function setupSocketListeners() {
    if (!socket) return;

    socket.off('render_stroke');
    socket.off('render_cursor');
    socket.off('clear_canvas');
    socket.off('connect');
    socket.off('disconnect');

    if (!isMockMode) {
      // Menerima koordinat kuas dari client lain via server UDP broadcast
      socket.on('render_stroke', (data) => {
        if (data.client_id !== currentUser.clientId) {
          drawLine(data.prev_x, data.prev_y, data.x, data.y, data.color, data.size);
        }
      });

      // Menerima sinyal pembersihan canvas
      socket.on('clear_canvas', () => {
        clearLocalCanvas();
      });

      function checkUDPStatus() {
          if (!socket || isMockMode || !socket.connected) {
              updateUDPStatus(false);
              return;
          }

          socket.emit('check_udp_status', {}, (response) => {
              updateUDPStatus(response && response.active === true);
          });
      }

      socket.on('connect', checkUDPStatus);

      socket.on('disconnect', () => {
          updateUDPStatus(false);
      });

      checkUDPStatus();
    }
  }

  function updateRemoteCursor(id, username, x, y) {
    if (!remoteCursorsContainer) return;

    let cursorEl = remoteCursors[id];
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = `
        <svg class="remote-cursor-pointer" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.5 3.5l14 7-6.5 2-2 6.5-5.5-15.5z"/>
        </svg>
        <span class="remote-cursor-badge">${escapeHtml(username)} • Socket.IO</span>
      `;
      remoteCursorsContainer.appendChild(cursorEl);
      remoteCursors[id] = cursorEl;
    }

    cursorEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  function clearLocalCanvas() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  }

  function handleClearCanvas() {
    if (confirm('Apakah Anda yakin ingin membersihkan kanvas?')) {
      clearLocalCanvas();

      if (socket && !isMockMode && socket.connected) {
        socket.emit('clear_canvas', {
          client_id: currentUser.clientId,
          username: currentUser.username,
          timestamp: Date.now() / 1000
        });
      }
    }
  }

  function setupToolbar() {
    // 1. Color Picker
    const colorButtons = document.querySelectorAll('.color-choice-btn');
    const colorHexInput = document.getElementById('color-hex-input');
    const colorHexIndicator = document.getElementById('color-hex-indicator');

    colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        colorButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentColor = btn.dataset.color;
        if (colorHexInput) colorHexInput.value = currentColor.toUpperCase();
        if (colorHexIndicator) colorHexIndicator.style.backgroundColor = currentColor;
      });
    });

    if (colorHexInput) {
      colorHexInput.addEventListener('change', (e) => {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        currentColor = val;
        if (colorHexIndicator) colorHexIndicator.style.backgroundColor = currentColor;
        colorButtons.forEach(b => {
          if (b.dataset.color.toLowerCase() === val.toLowerCase()) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
      });
    }

    // 2. Brush Size Buttons
    const sizeButtons = document.querySelectorAll('.brush-size-btn');
    const sizeLabel = document.getElementById('brush-size-label');

    sizeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        sizeButtons.forEach(b => {
          b.classList.remove('bg-brand-600', 'bg-blue-600', 'text-white');
          b.classList.add('text-slate-600', 'hover:bg-slate-200');
        });
        btn.classList.remove('text-slate-600', 'hover:bg-slate-200');
        btn.classList.add('bg-brand-600', 'text-white');

        currentSize = parseInt(btn.dataset.size, 10);
        if (sizeLabel) sizeLabel.textContent = `Size: ${currentSize}px`;
      });
    });

    // 3. Clear Button
    const clearBtn = document.getElementById('clear-canvas-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', handleClearCanvas);
    }
  }

  function updateUDPStatus(connected) {
      if (!udpStatusBadgeEl) return;

      if (connected) {
          udpStatusBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
          udpStatusBadgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> UDP Bridge (Port 5001): Active`;
      } else {
          udpStatusBadgeEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200';
          udpStatusBadgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> UDP Bridge (Port 5001): Inactive`;
      }
  }

  // Simulasi lingkaran merah dan kursor Rifqi sesuai gambar FE-Desain
  function initMockSimulation() {
    setTimeout(() => {
      // Gambar lingkaran merah persis seperti di screenshot FE-Desain/Live Whiteboard & Chat.png
      drawSampleMockCircle();

      // Posisikan kursor Rifqi • UDP di samping lingkaran merah
      updateRemoteCursor('rifqi_node', 'Rifqi', 220, 180);
    }, 400);
  }

  function drawSampleMockCircle() {
    if (!ctx) return;
    const centerX = 130;
    const centerY = 180;
    const radius = 65;

    ctx.save();
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0.2 * Math.PI, 2.1 * Math.PI);
    ctx.stroke();
    ctx.restore();
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
    drawLine,
    updateRemoteCursor,
    clearLocalCanvas,
    updateUDPStatus
  };
})();
