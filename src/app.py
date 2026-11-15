import os
from flask import Flask, render_template
from flask_socketio import SocketIO, emit

# Inisialisasi Flask
template_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'templates'))
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'static'))

app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
app.config['SECRET_KEY'] = 'jarkom_pbl2_secret_key'

# Inisialisasi Flask-SocketIO dengan CORS diizinkan
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Import handler TCP dan UDP jika sudah dibuat oleh tim Backend
try:
    import tcp_handler
    TCP_AVAILABLE = True
except ImportError:
    TCP_AVAILABLE = False
    print("[INFO] tcp_handler.py belum tersedia, menjalankan local broadcast fallback.")

try:
    import udp_handler
    UDP_AVAILABLE = True
except ImportError:
    UDP_AVAILABLE = False
    print("[INFO] udp_handler.py belum tersedia, menjalankan local broadcast fallback.")


@app.route('/')
def index():
    """Menyajikan halaman utama Whiteboard & Chat."""
    return render_template('index.html')


# ==========================================
# EVENT HANDLERS: TCP CHAT (PORT 5000)
# ==========================================

@socketio.on('send_chat')
def handle_send_chat(payload):
    print(f"[TCP Chat] Received from {payload.get('username')}: {payload.get('message')}")
    
    if TCP_AVAILABLE and hasattr(tcp_handler, 'send_chat_message'):
        try:
            tcp_handler.send_chat_message(payload)
        except Exception as e:
            print(f"[TCP Error] Gagal forward ke socket TCP: {e}")
            emit('receive_chat', payload, broadcast=True)
    else:
        # Local Broadcast jika backend raw socket belum diintegrasikan
        emit('receive_chat', payload, broadcast=True)


# ==========================================
# EVENT HANDLERS: UDP CANVAS (PORT 5001)
# ==========================================

@socketio.on('draw_stroke')
def handle_draw_stroke(payload):
    if UDP_AVAILABLE and hasattr(udp_handler, 'send_udp_stroke'):
        try:
            udp_handler.send_udp_stroke(payload)
        except Exception as e:
            emit('render_stroke', payload, broadcast=True, include_self=False)
    else:
        # Broadcast ke client lain (tanpa mengirim balik ke pengirim asli)
        emit('render_stroke', payload, broadcast=True, include_self=False)


@socketio.on('cursor_move')
def handle_cursor_move(payload):
    emit('render_cursor', payload, broadcast=True, include_self=False)


@socketio.on('clear_canvas')
def handle_clear_canvas(payload):
    print(f"[Canvas] Clear triggered by {payload.get('username')}")
    emit('clear_canvas', payload, broadcast=True)


@socketio.on('connect')
def handle_connect():
    print("[Client Connected] Browser client connected to Flask-SocketIO Bridge.")


@socketio.on('disconnect')
def handle_disconnect():
    print("[Client Disconnected] Browser client disconnected.")


if __name__ == '__main__':
    print("=" * 60)
    print(" Dual-Socket Whiteboard & Chat Server")
    print(" Running at: http://127.0.0.1:8080")
    print("=" * 60)
    socketio.run(app, host='0.0.0.0', port=8080, debug=True)
