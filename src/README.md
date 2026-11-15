# Frontend & Local Bridge - Dual-Socket Whiteboard & Chat

Komponen antarmuka pengguna web (*Frontend*) dan *WebSocket Bridge* untuk proyek tugas besar Jaringan Komputer: **Live Collaborative Whiteboard & Integrated Chat (TCP vs UDP Dual-Socket Performance Analysis)**.

---

## 📁 Struktur File Frontend

```text
src/
├── app.py                  # Server Flask & Socket.IO Local Bridge (Port 8080)
├── requirements.txt        # Dependensi Python Flask-SocketIO
├── README.md               # Dokumentasi petunjuk penggunaan Frontend
├── static/
│   ├── css/
│   │   └── style.css       # Grid whiteboard pattern, custom scrollbar & animation
│   └── js/
│       ├── canvas.js       # Logic HTML5 canvas, brush settings, pointer UDP & render
│       └── chat.js         # Logic chatbox TCP, bubble message formatting & auto-reply mock
└── templates/
    └── index.html          # SPA View Switch (Entry Screen & Live Dashboard)
```

---

## 🚀 Cara Menjalankan

### 1. Mode Standalone / Pengujian Langsung di Browser (Mock Mode)
Anda dapat langsung membuka file [index.html](file:///D:/CODE/PROJEK/Github/Jarkom-Project-Based-Learning-2/src/templates/index.html) langsung di browser apa pun tanpa menjalankan server Python terlebih dahulu.
* Frontend secara cerdas akan mendeteksi ketiadaan server backend dan otomatis mengaktifkan **Mock Simulation Mode**.
* Anda dapat mencoba menggambar di kanvas, mengganti warna, mengubah ukuran kuas, menghapus kanvas, dan mengirim pesan chat (akan dibalas otomatis oleh bot kawan lokal "Rifqi").
* Tampilan awal, tata letak, warna kuas, dan kursor kawan melayang (*remote cursor indicator*) dibuat persis 100% dengan desain di `FE-Desain/Entry Screen.png` dan `FE-Desain/Live Whiteboard & Chat.png`.

### 2. Mode Flask-SocketIO Bridge
Jalankan server Flask lokal di masing-masing mesin client:

```bash
# 1. Install dependensi
pip install -r src/requirements.txt

# 2. Jalankan aplikasi
python src/app.py
```

Buka browser Anda di `http://127.0.0.1:8080`.

---

## 📡 Kontrak Event Socket.IO (Frontend <-> Bridge)

### A. Jalur TCP (Chat / Messaging - Port 5000)
* **Kirim Pesan:** `socket.emit('send_chat', payload)`
* **Terima Pesan:** `socket.on('receive_chat', callback)`
* **Format Payload:**
```json
{
  "type": "chat_message",
  "client_id": "usr_node_01",
  "username": "Faiza",
  "message": "Tolong garis melingkar di area kiri atas dibersihkan",
  "timestamp": 1794301200.450
}
```

### B. Jalur UDP (Live Canvas Drawing - Port 5001)
* **Kirim Stroke:** `socket.emit('draw_stroke', payload)`
* **Terima Stroke:** `socket.on('render_stroke', callback)`
* **Kirim Kursor Pointer:** `socket.emit('cursor_move', payload)`
* **Terima Kursor Pointer:** `socket.on('render_cursor', callback)`
* **Clear Canvas:** `socket.emit('clear_canvas', payload)`
* **Format Payload:**
```json
{
  "type": "draw_stroke",
  "client_id": "usr_node_01",
  "stroke_id": 1042,
  "x": 425,
  "y": 280,
  "prev_x": 420,
  "prev_y": 278,
  "color": "#EF4444",
  "size": 5,
  "timestamp": 1794301200.482
}
```
