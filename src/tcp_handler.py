import socket
import threading
import json
import time
import logging

logger = logging.getLogger("TCPChat")

class TCPChatServer:
    def __init__(self, host="0.0.0.0", port=5000):
        self.host = host
        self.port = port
        self.server_socket = None
        self.clients = {}   
        self.clients_lock = threading.Lock()
        self.running = False
        self.MAX_PAYLOAD_SIZE = 1024

    def start(self):
        if self.running:
            return

        self.server_socket = socket.socket(
            socket.AF_INET,
            socket.SOCK_STREAM
        )
        self.server_socket.setsockopt(
            socket.SOL_SOCKET,
            socket.SO_REUSEADDR,
            1
        )
        self.server_socket.bind((self.host, self.port))
        self.server_socket.listen(20)

        self.running = True

        logger.info(
            f"TCP Chat Server listening on {self.host}:{self.port}"
        )

        threading.Thread(
            target=self._accept_loop,
            daemon=True
        ).start()

    def stop(self):
        self.running = False

        if self.server_socket:
            try:
                self.server_socket.close()
            except OSError:
                pass

        with self.clients_lock:
            clients = list(self.clients.keys())
            self.clients.clear()

        for client in clients:
            try:
                client.close()
            except OSError:
                pass

    def _accept_loop(self):
        while self.running:
            try:
                client_socket, address = self.server_socket.accept()
            except OSError:
                break

            logger.info(f"New TCP connection from {address}")

            with self.clients_lock:
                self.clients[client_socket] = {
                    "addr": address,
                    "username": None,
                    "send_lock": threading.Lock()
                }

            threading.Thread(
                target=self._handle_client,
                args=(client_socket, address),
                daemon=True
            ).start()

            self._broadcast({
                "type": "system",
                "message": f"User {address[0]} joined the chat.",
                "timestamp": time.time()
            })

            self._safe_send(client_socket, {
                "type": "system",
                "message": "Welcome to TCP Chat Server.",
                "timestamp": time.time()
            })

    def _handle_client(self, client_socket, address):
        buffer = bytearray()
        client_socket.settimeout(None)

        try:
            while self.running:
                data = client_socket.recv(4096)

                if not data:
                    break

                buffer.extend(data)

                if len(buffer) > self.MAX_PAYLOAD_SIZE and b"\n" not in buffer:
                    self._safe_send(client_socket, {
                        "type": "error",
                        "message": "Payload too large."
                    })
                    break

                while b"\n" in buffer:
                    line, _, remaining = buffer.partition(b"\n")
                    buffer = bytearray(remaining)

                    if not line.strip():
                        continue

                    if len(line) > self.MAX_PAYLOAD_SIZE:
                        self._safe_send(client_socket, {
                            "type": "error",
                            "message": "Payload too large."
                        })
                        continue

                    self._handle_message(
                        client_socket,
                        line.decode("utf-8", errors="replace")
                    )

        except socket.timeout:
            logger.warning(f"Client {address} timed out.")

        except (ConnectionResetError, OSError):
            pass

        except Exception:
            logger.exception(f"Error handling client {address}")

        finally:
            self._remove_client(client_socket)

    def _handle_message(self, client_socket, line):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            self._safe_send(client_socket, {
                "type": "error",
                "message": "Invalid JSON."
            })
            return

        if not isinstance(payload, dict):
            self._safe_send(client_socket, {
                "type": "error",
                "message": "Payload must be a JSON object."
            })
            return

        message_type = payload.get("type")

        if message_type == "chat_message":
            message = payload.get("message")

            if not isinstance(message, str) or not message.strip():
                self._safe_send(client_socket, {
                    "type": "error",
                    "message": "Message cannot be empty."
                })
                return

            if len(message) > 1024:
                self._safe_send(client_socket, {
                    "type": "error",
                    "message": "Message too long."
                })
                return

            username = payload.get("username", "Anon")

            with self.clients_lock:
                if client_socket in self.clients:
                    self.clients[client_socket]["username"] = username

            payload.setdefault("timestamp", time.time())
            payload["server_received_at"] = time.time()

            self._broadcast(payload)

        elif message_type == "typing":
            self._broadcast(payload, exclude_sender=client_socket)

        elif message_type in ("system", "user_join", "user_leave"):
            payload.setdefault("timestamp", time.time())
            payload["server_received_at"] = time.time()
            self._broadcast(payload)

        elif message_type == "ping":
            self._safe_send(client_socket, {
                "type": "pong",
                "echo_timestamp": payload.get("timestamp"),
                "server_timestamp": time.time()
            })

        elif message_type == "disconnect":
            self._remove_client(client_socket)

        else:
            self._safe_send(client_socket, {
                "type": "error",
                "message": f"Unknown message type: {message_type}"
            })

    def _broadcast(self, payload, exclude_sender=None):
        data = (json.dumps(payload) + "\n").encode("utf-8")

        with self.clients_lock:
            targets = [
                (client, info["send_lock"])
                for client, info in self.clients.items()
                if client != exclude_sender
            ]

        for client, send_lock in targets:
            try:
                with send_lock:
                    client.sendall(data)
            except OSError:
                self._remove_client(client)

    def _safe_send(self, client_socket, payload):
        with self.clients_lock:
            info = self.clients.get(client_socket)

        if not info:
            return

        try:
            data = (json.dumps(payload) + "\n").encode("utf-8")

            with info["send_lock"]:
                client_socket.sendall(data)

        except OSError:
            self._remove_client(client_socket)

    def _remove_client(self, client_socket):
        with self.clients_lock:
            info = self.clients.pop(client_socket, None)

        if info is None:
            return

        try:
            client_socket.close()
        except OSError:
            pass

        logger.info(f"Client disconnected: {info['addr']}")

        self._broadcast({
            "type": "system",
            "message": f"User {info['addr'][0]} left the chat.",
            "timestamp": time.time()
        })

tcp_server = TCPChatServer()

bridge_socket = None
bridge_running = False
bridge_send_lock = threading.Lock()


def start_tcp_bridge(on_message, host="127.0.0.1", port=5000):
    global bridge_socket, bridge_running

    if bridge_running:
        return

    try:
        bridge_socket = socket.create_connection((host, port), timeout=5)
        bridge_socket.settimeout(None)
        bridge_running = True

        logger.info(f"TCP Bridge connected to {host}:{port}")

        threading.Thread(
            target=_bridge_receive_loop,
            args=(on_message,),
            daemon=True
        ).start()

    except OSError:
        bridge_running = False
        bridge_socket = None
        raise


def _bridge_receive_loop(on_message):
    global bridge_running, bridge_socket

    buffer = bytearray()

    try:
        while bridge_running:
            data = bridge_socket.recv(4096)

            if not data:
                break

            buffer.extend(data)

            while b"\n" in buffer:
                line, _, remaining = buffer.partition(b"\n")
                buffer = bytearray(remaining)

                if not line.strip():
                    continue

                try:
                    payload = json.loads(line.decode("utf-8"))

                    if isinstance(payload, dict):
                        msg_type = payload.get("type")
                        if msg_type in ("chat_message", "system", "user_join", "user_leave"):
                            on_message(payload)

                except (json.JSONDecodeError, UnicodeDecodeError):
                    logger.warning("Invalid message received from TCP server.")

    except OSError:
        if bridge_running:
            logger.exception("TCP Bridge connection lost.")

    finally:
        bridge_running = False

        if bridge_socket:
            try:
                bridge_socket.close()
            except OSError:
                pass

        bridge_socket = None
        logger.warning("TCP Bridge disconnected.")


def stop_tcp_bridge():
    global bridge_running, bridge_socket

    bridge_running = False

    if bridge_socket:
        try:
            bridge_socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

        try:
            bridge_socket.close()
        except OSError:
            pass

    bridge_socket = None

def start_tcp_server():
    tcp_server.start()

def stop_tcp_server():
    tcp_server.stop()

def send_chat_message(payload):
    if not tcp_server.running:
        raise RuntimeError("TCP server is not running.")

    if not bridge_running or bridge_socket is None:
        raise RuntimeError("TCP Bridge is not connected.")

    if not isinstance(payload, dict):
        raise ValueError("Payload must be a dictionary.")

    if payload.get("type") not in ("chat_message", "typing", "system", "user_join", "user_leave"):
        raise ValueError("Invalid message type.")

    data = (json.dumps(payload) + "\n").encode("utf-8")

    with bridge_send_lock:
        bridge_socket.sendall(data)
