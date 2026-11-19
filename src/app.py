import os
import time
import threading
from flask import Flask, render_template, request
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


# Penyimpanan sesi user aktif: { sid: { 'username': str, 'client_id': str, 'joined_at': float } }
online_users = {}
online_users_lock = threading.Lock()

def get_online_users_list():
    with online_users_lock:
        unique = {}
        for sid, user_data in online_users.items():
            cid = user_data.get('client_id')
            if cid:
                unique[cid] = user_data
        return list(unique.values())

def broadcast_online_users():
    users = get_online_users_list()
    socketio.emit('online_users_updated', {
        'count': len(users),
        'users': users
    })


@app.route('/')
def index():
    """Menyajikan halaman utama Whiteboard & Chat."""
    return render_template('index.html')


# ==========================================
# EVENT HANDLERS: TCP CHAT (PORT 5000)
# ==========================================
def handle_tcp_message(payload):
    socketio.emit('receive_chat', payload)

@socketio.on('send_chat')
def handle_send_chat(payload):
    print(f"[TCP Chat] Received from {payload.get('username')}: {payload.get('message')}")

    if TCP_AVAILABLE and hasattr(tcp_handler, 'send_chat_message'):
        try:
            tcp_handler.send_chat_message(payload)
        except Exception as e:
            print(f"[TCP Error] Gagal mengirim pesan ke TCP Server: {e}")
    else:
        socketio.emit('receive_chat', payload)


@socketio.on('user_join')
def handle_user_join(payload):
    sid = getattr(request, 'sid', None)
    username = payload.get('username', 'Anonymous')
    client_id = payload.get('client_id')

    if sid:
        with online_users_lock:
            online_users[sid] = {
                'username': username,
                'client_id': client_id,
                'joined_at': time.time()
            }

    print(f"[User Join] {username} ({client_id}) bergabung ke sesi. Total online: {len(get_online_users_list())}")

    join_payload = {
        'type': 'system',
        'client_id': client_id,
        'username': username,
        'message': f"{username} bergabung ke sesi obrolan.",
        'timestamp': payload.get('timestamp') or time.time()
    }

    if TCP_AVAILABLE and hasattr(tcp_handler, 'send_chat_message'):
        try:
            tcp_handler.send_chat_message(join_payload)
        except Exception as e:
            print(f"[TCP Error] Gagal mengirim user_join ke TCP Server: {e}")
            socketio.emit('receive_chat', join_payload)
    else:
        socketio.emit('receive_chat', join_payload)

    broadcast_online_users()


@socketio.on('user_leave')
def handle_user_leave(payload):
    sid = getattr(request, 'sid', None)
    username = payload.get('username')
    client_id = payload.get('client_id')

    if sid:
        with online_users_lock:
            user_info = online_users.pop(sid, None)
            if user_info:
                username = user_info.get('username', username)
                client_id = user_info.get('client_id', client_id)

    if not username:
        username = 'Anonymous'

    print(f"[User Leave] {username} ({client_id}) meninggalkan sesi.")

    leave_payload = {
        'type': 'user_leave',
        'client_id': client_id,
        'username': username,
        'message': f"{username} meninggalkan sesi obrolan.",
        'timestamp': payload.get('timestamp') or time.time()
    }

    if TCP_AVAILABLE and hasattr(tcp_handler, 'send_chat_message'):
        try:
            tcp_handler.send_chat_message(leave_payload)
        except Exception as e:
            print(f"[TCP Error] Gagal mengirim user_leave ke TCP Server: {e}")
            socketio.emit('receive_chat', leave_payload)
    else:
        socketio.emit('receive_chat', leave_payload)

    broadcast_online_users()


@socketio.on('get_online_users')
def handle_get_online_users():
    emit('online_users_updated', {
        'count': len(get_online_users_list()),
        'users': get_online_users_list()
    })


@socketio.on('typing')
def handle_typing(payload):
    # Broadcast status pengetikan ke browser client lain
    emit('user_typing', payload, broadcast=True, include_self=False)

    # Teruskan ke TCP Server jika tersedia
    if TCP_AVAILABLE and hasattr(tcp_handler, 'send_chat_message'):
        try:
            tcp_handler.send_chat_message({
                'type': 'typing',
                'client_id': payload.get('client_id'),
                'username': payload.get('username'),
                'is_typing': payload.get('is_typing', False)
            })
        except Exception:
            pass


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
    # Kirim daftar pengguna online terkini ke client yang baru terkoneksi
    emit('online_users_updated', {
        'count': len(get_online_users_list()),
        'users': get_online_users_list()
    })


@socketio.on('disconnect')
def handle_disconnect():
    sid = getattr(request, 'sid', None)
    user_info = None

    if sid:
        with online_users_lock:
            user_info = online_users.pop(sid, None)

    if user_info:
        username = user_info.get('username', 'Anonymous')
        client_id = user_info.get('client_id')
        print(f"[Client Disconnected] {username} ({client_id}) disconnected.")

        leave_payload = {
            'type': 'user_leave',
            'client_id': client_id,
            'username': username,
            'message': f"{username} meninggalkan sesi obrolan.",
            'timestamp': time.time()
        }

        if TCP_AVAILABLE and hasattr(tcp_handler, 'send_chat_message'):
            try:
                tcp_handler.send_chat_message(leave_payload)
            except Exception as e:
                socketio.emit('receive_chat', leave_payload)
        else:
            socketio.emit('receive_chat', leave_payload)

        broadcast_online_users()
    else:
        print("[Client Disconnected] Client disconnected.")


if __name__ == '__main__':
    print("=" * 60)
    print(" Dual-Socket Whiteboard & Chat Server")
    print(" Running at: http://127.0.0.1:8080")
    print("=" * 60)

    if TCP_AVAILABLE:
        tcp_handler.start_tcp_server()

        try:
            tcp_handler.start_tcp_bridge(handle_tcp_message)
            print("[TCP Bridge] Connected to TCP Server on port 5000.")
        except OSError as e:
            print(f"[TCP Bridge Error] Failed to connect: {e}")

    socketio.run(
        app,
        host='0.0.0.0',
        port=8080,
        debug=True,
        use_reloader=False
    )
