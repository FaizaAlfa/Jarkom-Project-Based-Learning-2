# Jarkom-Project-Based-Learning-2
merancang, mengimplementasikan, dan menganalisis kinerja layanan/protokol pada Application Layer yang ditumpangkan di atas dua protokol Transport Layer yang berbeda (TCP dan UDP).

Struktur utama repository:
```
├── LAPORAN_KELOMPOK_[XX].pdf
├── capture_tcp.pcapng
├── capture_udp.pcapng
└── src/
    ├── README.md
    ├── app.py              # Server Flask utama
    ├── tcp_handler.py      # Module socket TCP (SOCK_STREAM)
    ├── udp_handler.py      # Module socket UDP (SOCK_DGRAM)
    ├── static/
    │   ├── js/canvas.js    # Event listener canvas & sender
    │   └── css/style.css
    └── templates/
        └── index.html      # Tampilan Web Whiteboard
```
