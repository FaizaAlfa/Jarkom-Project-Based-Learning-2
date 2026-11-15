# Live Collaborative Whiteboard & Integrated Chat
### TCP vs UDP Dual-Socket Performance Analysis (Jarkom Project-Based Learning #2)

Proyek ini merancang, mengimplementasikan, dan menganalisis performa dua protokol *Transport Layer* yang berbeda pada aplikasi web kolaboratif:
* **TCP (`SOCK_STREAM` - Port 5000):** Menangani transmisi obrolan teks (*chat*) yang mengutamakan keandalan pesan (*reliable*, *in-order delivery*).
* **UDP (`SOCK_DGRAM` - Port 5001):** Menangani *streaming stroke* kuas kanvas menggambar yang memprioritaskan latensi sangat rendah (*near-zero latency*).
* **Flask-SocketIO Bridge (Port 8080):** Menyajikan antarmuka pengguna berbasis web dan menjembatani *event* peramban ke socket TCP/UDP lokal.

---

## 📁 Struktur Repositori

```text
.
├── .gitignore
├── README.md                           # Dokumentasi umum repositori
├── LAPORAN_KELOMPOK_[XX].pdf           # Laporan akhir tugas besar
├── capture_tcp.pcapng                  # Berkas capture Wireshark TCP (Chat)
├── capture_udp.pcapng                  # Berkas capture Wireshark UDP (Canvas)
└── src/
    ├── README.md                       # Panduan teknis modul src
    ├── requirements.txt                # Dependensi Python
    ├── app.py                          # Server Flask utama & Socket.IO local bridge
    ├── tcp_handler.py                  # Module socket TCP (SOCK_STREAM)
    ├── udp_handler.py                  # Module socket UDP (SOCK_DGRAM)
    ├── static/
    │   ├── css/
    │   │   └── style.css               # Styling layout kanvas & grid
    │   └── js/
    │       ├── canvas.js               # Handler kanvas HTML5 & streaming UDP
    │       └── chat.js                 # Handler chatbox & transmisi TCP
    └── templates/
        └── index.html                  # Antarmuka SPA (Entry Screen & Dashboard)
```

---

## 🚀 Panduan Memulai

### 1. Mode Standalone (Mock Simulation di Browser)
Buka berkas `src/templates/index.html` langsung di peramban web tanpa perlu menjalankan server Python. Mode simulasi lokal akan aktif otomatis untuk kebutuhan pengujian antarmuka.

### 2. Mode Flask-SocketIO Server
```bash
# Pasang pustaka pendukung
pip install -r src/requirements.txt

# Jalankan server aplikasi
python src/app.py
```
Akses melalui peramban di: `http://127.0.0.1:8080`.
