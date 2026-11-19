import socket
import json
import threading
import time
import sys

HOST = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.106"
PORT = 5000

class TCPChatClient:
    def __init__(self, username="TestUser"):
        self.username = username
        self.client_id = "usr_" + username.lower()
        self.sock = None
        self.buffer = ""
        self.running = False
        self.send_lock = threading.Lock()

    def connect(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

        try:
            self.sock.connect((HOST, PORT))
            self.running = True

            threading.Thread(
                target=self._recv,
                daemon=True
            ).start()

            print(f"[OK] Connected to {HOST}:{PORT}")
            return True

        except OSError as e:
            print(f"[ERROR] Connection failed: {e}")
            self.sock.close()
            self.sock = None
            return False

    def _recv(self):
        while self.running:
            try:
                data = self.sock.recv(4096)

                if not data:
                    print("\n[INFO] Server disconnected.")
                    break

                self.buffer += data.decode("utf-8", errors="replace")

                while "\n" in self.buffer:
                    line, self.buffer = self.buffer.split("\n", 1)

                    if line.strip():
                        print(f"\n[RX] {line}")
                        print("You: ", end="", flush=True)

            except OSError:
                break

        self.running = False

    def send(self, msg):
        if not self.running:
            print("[ERROR] Not connected to server.")
            return

        if not msg.strip():
            return

        payload = {
            "type": "chat_message",
            "client_id": self.client_id,
            "username": self.username,
            "message": msg,
            "timestamp": time.time()
        }

        try:
            data = (json.dumps(payload) + "\n").encode("utf-8")

            with self.send_lock:
                self.sock.sendall(data)

        except OSError as e:
            print(f"[ERROR] Failed to send message: {e}")
            self.running = False

    def disconnect(self):
        if self.sock is None:
            return

        if self.running:
            try:
                payload = {
                    "type": "disconnect",
                    "client_id": self.client_id
                }

                data = (json.dumps(payload) + "\n").encode("utf-8")

                with self.send_lock:
                    self.sock.sendall(data)

            except OSError:
                pass

        self.running = False

        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

        try:
            self.sock.close()
        except OSError:
            pass

        print("\n[INFO] Disconnected.")

if __name__ == "__main__":
    username = sys.argv[2] if len(sys.argv) > 2 else "Tester"

    client = TCPChatClient(username)

    if client.connect():
        try:
            while client.running:
                message = input("You: ")

                if message.lower() in ("exit", "quit"):
                    break

                client.send(message)

        except (EOFError, KeyboardInterrupt):
            pass

        finally:
            client.disconnect()
