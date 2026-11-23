/**
 * canvas.js - UDP Canvas Drawing Logic & UDP Live Cursor Tracking
 * Menangani streaming data live canvas drawing via UDP Datagram (Port 5001)
 * serta live remote cursor tracking via UDP Datagram (Port 5002) dan Socket.IO Bridge.
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

  // Tool & Drawing State
  let currentTool = 'pen'; // 'pen' | 'eraser'
  let isDrawing = false;
  let currentColor = '#EF4444'; // Default merah
  let currentSize = 5;          // Default 5px
  let prevPos = { x: 0, y: 0 };
  let strokeCounter = 1000;

  // Remote cursors container & active tracker
  let remoteCursorsContainer = null;
  const remoteCursors = {}; // { [client_id]: { element: HTMLElement, timer: number } }

  // Throttling untuk live cursor
  let lastCursorSentTime = 0;
  const CURSOR_THROTTLE_MS = 30; // ~33 update per detik untuk efisiensi jaringan & kelancaran visual

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
    canvas.addEventListener('mousemove', (e) => {
      draw(e);
      handleMouseMove(e);
    });
    window.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Touch events untuk mobile/tablet
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDrawing(e);
      handleMouseMove(e);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      draw(e);
      handleMouseMove(e);
    }, { passive: false });

    window.addEventListener('touchend', () => {
      stopDrawing();
      handleMouseLeave();
    });
  }

  function handleMouseMove(e) {
    const pos = getCanvasCoords(e);
    const now = performance.now();
    if (now - lastCursorSentTime >= CURSOR_THROTTLE_MS) {
      lastCursorSentTime = now;
      sendCursorPosition(pos.x, pos.y, isDrawing, currentTool === 'eraser');
    }
  }

  function handleMouseLeave() {
    if (isDrawing) stopDrawing();
    if (socket && !isMockMode && socket.connected) {
      socket.emit('cursor_leave', {
        client_id: currentUser.clientId
      });
    }
  }

  function startDrawing(e) {
    isDrawing = true;
    const pos = getCanvasCoords(e);
    prevPos = { x: pos.x, y: pos.y };
    const isEraser = (currentTool === 'eraser');

    // Gambar titik awal
    drawLine(pos.x, pos.y, pos.x, pos.y, currentColor, currentSize, isEraser);

    // Kirim stroke pertama via UDP
    sendStroke(pos.x, pos.y, pos.x, pos.y, isEraser);
  }

  function draw(e) {
    if (!isDrawing) return;

    const pos = getCanvasCoords(e);
    const isEraser = (currentTool === 'eraser');

    // Gambar lokal
    drawLine(prevPos.x, prevPos.y, pos.x, pos.y, currentColor, currentSize, isEraser);

    // Kirim via UDP event
    sendStroke(pos.x, pos.y, prevPos.x, prevPos.y, isEraser);

    prevPos = { x: pos.x, y: pos.y };
  }

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    // Beritahukan perubahan status kursor menjadi tidak menggambar
    const now = performance.now();
    if (now - lastCursorSentTime >= CURSOR_THROTTLE_MS) {
      lastCursorSentTime = now;
      sendCursorPosition(prevPos.x, prevPos.y, false, currentTool === 'eraser');
    }
  }

  function drawLine(fromX, fromY, toX, toY, color, size, isEraser = false) {
    if (!ctx) return;
    ctx.save();

    if (isEraser) {
      // Menghapus transparan secara bersih sehingga grid background tetap tampak rapi
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = size * 2.5; // Penghapus sedikit lebih tebal agar nyaman
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  function sendStroke(x, y, prev_x, prev_y, isEraser = false) {
    strokeCounter++;

    // Sesuai payload canvas UDP Port 5001
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
      is_eraser: !!isEraser,
      timestamp: Date.now() / 1000
    };

    if (socket && !isMockMode && socket.connected) {
      socket.emit('draw_stroke', payload);
    }
  }

  function sendCursorPosition(x, y, drawing = false, erasing = false) {
    // Sesuai payload cursor tracking UDP Port 5002
    const cursorPayload = {
      type: 'cursor_move',
      client_id: currentUser.clientId,
      username: currentUser.username,
      x: x,
      y: y,
      is_drawing: !!drawing,
      is_eraser: !!erasing,
      color: currentColor,
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
    socket.off('remove_cursor');
    socket.off('clear_canvas');
    socket.off('connect');
    socket.off('disconnect');

    if (!isMockMode) {
      // Menerima koordinat kuas / penghapus dari client lain via server UDP Port 5001 broadcast
      socket.on('render_stroke', (data) => {
        if (data.client_id !== currentUser.clientId) {
          drawLine(data.prev_x, data.prev_y, data.x, data.y, data.color, data.size, !!data.is_eraser);
        }
      });

      // Menerima koordinat live cursor dari client lain via server UDP Port 5002 broadcast
      socket.on('render_cursor', (data) => {
        if (data && data.client_id !== currentUser.clientId) {
          updateRemoteCursor(data);
        }
      });

      // Menerima notifikasi kursor client lain keluar kanvas
      socket.on('remove_cursor', (data) => {
        if (data && data.client_id) {
          removeRemoteCursor(data.client_id);
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

  function updateRemoteCursor(data) {
    if (!remoteCursorsContainer || !data || !data.client_id) return;
    const id = data.client_id;
    const username = data.username || 'Friend';
    const x = data.x || 0;
    const y = data.y || 0;
    const isDrawingState = !!data.is_drawing;
    const isEraserState = !!data.is_eraser;
    const cursorColor = isEraserState ? '#F43F5E' : (data.color || '#8B5CF6');

    let tracker = remoteCursors[id];
    if (!tracker) {
      const cursorEl = document.createElement('div');
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = `
        <div class="remote-cursor-pulse"></div>
        <svg class="remote-cursor-pointer" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.5 3.5l14 7-6.5 2-2 6.5-5.5-15.5z"/>
        </svg>
        <span class="remote-cursor-badge"></span>
      `;
      remoteCursorsContainer.appendChild(cursorEl);
      tracker = { element: cursorEl, timer: null };
      remoteCursors[id] = tracker;
    }

    const el = tracker.element;
    el.style.opacity = '1';
    el.style.transform = `translate(${x}px, ${y}px)`;

    const pointer = el.querySelector('.remote-cursor-pointer');
    if (pointer) pointer.style.color = cursorColor;

    const pulse = el.querySelector('.remote-cursor-pulse');
    if (pulse) pulse.style.borderColor = cursorColor;

    if (isDrawingState) {
      el.classList.add('is-drawing');
    } else {
      el.classList.remove('is-drawing');
    }

    const badge = el.querySelector('.remote-cursor-badge');
    if (badge) {
      if (isEraserState) {
        badge.className = 'remote-cursor-badge is-eraser';
        badge.innerHTML = `${escapeHtml(username)} • Penghapus`;
      } else if (isDrawingState) {
        badge.className = 'remote-cursor-badge';
        badge.style.backgroundColor = cursorColor;
        badge.innerHTML = `${escapeHtml(username)} • Menggambar`;
      } else {
        badge.className = 'remote-cursor-badge';
        badge.style.backgroundColor = cursorColor;
        badge.innerHTML = `${escapeHtml(username)} • UDP:5002`;
      }
    }

    // Auto-hide kursor jika client tidak bergerak selama 3.5 detik
    if (tracker.timer) clearTimeout(tracker.timer);
    tracker.timer = setTimeout(() => {
      removeRemoteCursor(id);
    }, 3500);
  }

  function removeRemoteCursor(id) {
    const tracker = remoteCursors[id];
    if (tracker) {
      if (tracker.timer) clearTimeout(tracker.timer);
      if (tracker.element && tracker.element.parentNode) {
        tracker.element.style.opacity = '0';
        setTimeout(() => {
          if (tracker.element && tracker.element.parentNode) {
            tracker.element.parentNode.removeChild(tracker.element);
          }
        }, 200);
      }
      delete remoteCursors[id];
    }
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
    // 1. Tool Switcher (Pen vs Eraser)
    const penBtn = document.getElementById('tool-pen-btn');
    const eraserBtn = document.getElementById('tool-eraser-btn');
    const colorPaletteContainer = document.getElementById('color-palette-container');

    function setTool(tool) {
      currentTool = tool;
      if (tool === 'pen') {
        if (penBtn) {
          penBtn.className = 'tool-mode-btn active flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-brand-600 shadow-xs border border-slate-200 transition';
        }
        if (eraserBtn) {
          eraserBtn.className = 'tool-mode-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
        }
        if (colorPaletteContainer) {
          colorPaletteContainer.classList.remove('opacity-40', 'pointer-events-none');
        }
        if (canvasContainer) {
          canvasContainer.style.cursor = 'crosshair';
        }
      } else {
        if (eraserBtn) {
          eraserBtn.className = 'tool-mode-btn active flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-rose-600 shadow-xs border border-slate-200 transition';
        }
        if (penBtn) {
          penBtn.className = 'tool-mode-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
        }
        if (colorPaletteContainer) {
          colorPaletteContainer.classList.add('opacity-40', 'pointer-events-none');
        }
        if (canvasContainer) {
          canvasContainer.style.cursor = 'cell';
        }
      }
    }

    if (penBtn) {
      penBtn.addEventListener('click', () => setTool('pen'));
    }
    if (eraserBtn) {
      eraserBtn.addEventListener('click', () => setTool('eraser'));
    }

    // 2. Color Picker
    const colorButtons = document.querySelectorAll('.color-choice-btn');
    const colorHexInput = document.getElementById('color-hex-input');
    const colorHexIndicator = document.getElementById('color-hex-indicator');

    colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Otomatis kembalikan ke mode pen jika user memilih warna
        if (currentTool !== 'pen') {
          setTool('pen');
        }
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
        if (currentTool !== 'pen') setTool('pen');
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

    // 3. Brush Size Buttons
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

    // 4. Clear Button
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
    removeRemoteCursor,
    clearLocalCanvas,
    updateUDPStatus
  };
})();
