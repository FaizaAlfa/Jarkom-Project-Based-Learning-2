
"""
UDP Canvas Handler — SOCK_DGRAM, port 5001.
Menerima stroke dari Flask UDP bridge dan UDP client, lalu broadcast ke client terdaftar.
Menyimpan riwayat stroke untuk kebutuhan polling atau debugging.
"""
import json
import logging
import socket
import threading
import time

logger = logging.getLogger("UDPCanvas")

MAX_UDP_PAYLOAD = 65507
CANVAS_MESSAGE_TYPES = ("draw_stroke", "clear_canvas", "clear")


class UDPCanvasServer:
    def __init__(self, host="0.0.0.0", port=5001, max_history=500):
        self.host = host
        self.port = port
        self.sock = None
        self.clients = set()
        self.clients_lock = threading.Lock()
        self.stroke_history = []
        self.history_lock = threading.Lock()
        self.max_history = max_history
        self.running = False
        self.stroke_counter = 0

    def start(self):
        if self.running:
            return

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((self.host, self.port))
        self.running = True

        logger.info("UDP Canvas Server listening on %s:%s", self.host, self.port)
        threading.Thread(target=self._recv_loop, daemon=True).start()

    def stop(self):
        self.running = False

        with self.clients_lock:
            self.clients.clear()

        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def _recv_loop(self):
        while self.running:
            try:
                data, addr = self.sock.recvfrom(MAX_UDP_PAYLOAD)
            except OSError:
                break

            try:
                payload = json.loads(data.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                logger.warning("Invalid UDP JSON received from %s", addr)
                continue

            if not isinstance(payload, dict):
                logger.warning("Invalid UDP payload from %s", addr)
                continue

            message_type = payload.get("type")

            if message_type == "register":
                with self.clients_lock:
                    self.clients.add(addr)

                logger.info("UDP client registered: %s", addr)
                self._send_to(addr, {
                    "type": "registered",
                    "timestamp": time.time()
                })

            elif message_type == "unregister":
                with self.clients_lock:
                    self.clients.discard(addr)

                logger.info("UDP client unregistered: %s", addr)

            elif message_type in CANVAS_MESSAGE_TYPES:
                self._add_stroke(payload)
                logger.info("UDP received %s from %s", message_type, addr)
                self._broadcast(payload)

    def _add_stroke(self, payload):
        with self.history_lock:
            self.stroke_counter += 1
            payload["_seq"] = self.stroke_counter
            self.stroke_history.append(payload)

            if len(self.stroke_history) > self.max_history:
                self.stroke_history.pop(0)

    def broadcast_stroke(self, payload):
        """Mencatat dan mengirim payload ke seluruh UDP client terdaftar."""
        if not isinstance(payload, dict):
            raise ValueError("UDP payload must be a dictionary.")

        self._add_stroke(payload)
        self._broadcast(payload)

    def _broadcast(self, payload):
        with self.clients_lock:
            targets = list(self.clients)

        for addr in targets:
            self._send_to(addr, payload)

    def _send_to(self, addr, payload):
        if not self.sock:
            return

        try:
            data = json.dumps(payload).encode("utf-8")

            if len(data) > MAX_UDP_PAYLOAD:
                logger.warning("UDP payload too large; dropped.")
                return

            self.sock.sendto(data, addr)
        except OSError:
            logger.exception("Failed to send UDP packet to %s", addr)

    def get_strokes_since(self, seq):
        with self.history_lock:
            return [
                stroke for stroke in self.stroke_history
                if stroke.get("_seq", 0) > seq
            ]


udp_server = UDPCanvasServer()

_bridge_socket = None
_bridge_running = False
_bridge_send_lock = threading.Lock()
_bridge_socket_lock = threading.Lock()


def start_udp_server():
    udp_server.start()


def stop_udp_server():
    udp_server.stop()


def start_udp_bridge(on_message, host="127.0.0.1", port=5001):
    """
    Membuat UDP client internal untuk menghubungkan UDP server dengan Flask-SocketIO.
    """
    global _bridge_socket, _bridge_running

    if _bridge_running:
        return

    if not udp_server.running:
        raise RuntimeError("UDP server must be started before UDP bridge.")

    bridge = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    bridge.bind(("0.0.0.0", 0))
    bridge.settimeout(1.0)

    try:
        bridge.sendto(
            json.dumps({
                "type": "register",
                "timestamp": time.time()
            }).encode("utf-8"),
            (host, port)
        )
    except OSError:
        bridge.close()
        raise

    with _bridge_socket_lock:
        _bridge_socket = bridge
        _bridge_running = True

    logger.info(
        "UDP Flask bridge registered to %s:%s from %s",
        host, port, bridge.getsockname()
    )

    threading.Thread(
        target=_udp_bridge_receive_loop,
        args=(on_message,),
        daemon=True
    ).start()


def _udp_bridge_receive_loop(on_message):
    global _bridge_socket, _bridge_running

    while _bridge_running:
        with _bridge_socket_lock:
            bridge = _bridge_socket

        if bridge is None:
            break

        try:
            data, _ = bridge.recvfrom(MAX_UDP_PAYLOAD)
        except socket.timeout:
            continue
        except OSError:
            break

        try:
            payload = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("Invalid UDP packet received by Flask bridge.")
            continue

        if not isinstance(payload, dict):
            continue

        if payload.get("type") not in CANVAS_MESSAGE_TYPES:
            continue

        try:
            on_message(payload)
        except Exception:
            logger.exception("UDP bridge callback failed.")

    logger.info("UDP Flask bridge receive loop stopped.")


def send_udp_stroke(payload, host="127.0.0.1", port=5001):
    """Mengirim stroke atau clear dari Flask ke UDP server."""
    if not isinstance(payload, dict):
        raise ValueError("UDP payload must be a dictionary.")

    if payload.get("type") not in CANVAS_MESSAGE_TYPES:
        raise ValueError("Invalid UDP canvas message type.")

    data = json.dumps(payload).encode("utf-8")

    if len(data) > MAX_UDP_PAYLOAD:
        raise ValueError("UDP payload exceeds the maximum datagram size.")

    with _bridge_socket_lock:
        bridge = _bridge_socket

        if not _bridge_running or bridge is None:
            raise RuntimeError("UDP Flask bridge is not running.")

        with _bridge_send_lock:
            bridge.sendto(data, (host, port))


def stop_udp_bridge(host="127.0.0.1", port=5001):
    global _bridge_socket, _bridge_running

    with _bridge_socket_lock:
        bridge = _bridge_socket
        _bridge_running = False
        _bridge_socket = None

    if bridge:
        try:
            bridge.sendto(
                json.dumps({"type": "unregister"}).encode("utf-8"),
                (host, port)
            )
        except OSError:
            pass

        try:
            bridge.close()
        except OSError:
            pass

def is_udp_bridge_running():
    with _bridge_socket_lock:
        return (
            _bridge_running
            and _bridge_socket is not None
            and udp_server.running
        )


# ==========================================
# UDP LIVE CURSOR TRACKING (PORT 5002)
# ==========================================

class UDPCursorServer:
    """
    UDP Cursor Server — SOCK_DGRAM, port 5002.
    Menerima paket live cursor tracking dari Flask bridge / client UDP.
    Memungkinkan Wireshark menangkap trafik kursor di port 5002 terpisah.
    """
    def __init__(self, host="0.0.0.0", port=5002):
        self.host = host
        self.port = port
        self.sock = None
        self.running = False
        self.clients = set()
        self.clients_lock = threading.Lock()

    def start(self):
        if self.running:
            return

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((self.host, self.port))
        self.running = True

        logger.info("UDP Cursor Server listening on %s:%s", self.host, self.port)
        threading.Thread(target=self._recv_loop, daemon=True).start()

    def stop(self):
        self.running = False
        with self.clients_lock:
            self.clients.clear()
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def _recv_loop(self):
        while self.running:
            try:
                data, addr = self.sock.recvfrom(MAX_UDP_PAYLOAD)
            except OSError:
                break

            try:
                payload = json.loads(data.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue

            if not isinstance(payload, dict):
                continue

            message_type = payload.get("type")
            if message_type == "register":
                with self.clients_lock:
                    self.clients.add(addr)
            elif message_type == "unregister":
                with self.clients_lock:
                    self.clients.discard(addr)
            elif message_type in ("cursor_move", "cursor_leave"):
                with self.clients_lock:
                    targets = [c for c in self.clients if c != addr]
                for client_addr in targets:
                    try:
                        self.sock.sendto(data, client_addr)
                    except OSError:
                        pass


udp_cursor_server = UDPCursorServer()
_cursor_send_sock = None
_cursor_send_lock = threading.Lock()


def start_udp_cursor_server():
    udp_cursor_server.start()


def stop_udp_cursor_server():
    global _cursor_send_sock
    udp_cursor_server.stop()
    with _cursor_send_lock:
        if _cursor_send_sock:
            try:
                _cursor_send_sock.close()
            except OSError:
                pass
            _cursor_send_sock = None


def send_udp_cursor(payload, host="127.0.0.1", port=5002):
    """Mengirim datagram koordinat live cursor ke port 5002 (UDP)."""
    global _cursor_send_sock
    if not isinstance(payload, dict):
        return

    data = json.dumps(payload).encode("utf-8")
    with _cursor_send_lock:
        if _cursor_send_sock is None:
            _cursor_send_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            _cursor_send_sock.sendto(data, (host, port))
        except OSError:
            pass
