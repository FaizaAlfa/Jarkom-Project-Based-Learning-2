"""
UDP listener — daftarkan diri ke server, lalu print setiap stroke yang diterima.
Jalankan ini SEBELUM melakukan drawing, untuk menghasilkan trafik UDP nyata.
"""
import socket, json, sys, time

HOST = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
PORT = 5001

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", 0))   # ephemeral port
local = sock.getsockname()
print(f"[UDP] listening on {local}")

# register
sock.sendto(json.dumps({"type": "register", "timestamp": time.time()}).encode(),
            (HOST, PORT))
print(f"[UDP] registered to {HOST}:{PORT}")

try:
    while True:
        data, addr = sock.recvfrom(65535)
        try:
            p = json.loads(data.decode())
            print(f"[UDP RX] {addr} type={p.get('type')} seq={p.get('_seq')} x={p.get('x')} y={p.get('y')}")
        except Exception:
            print(f"[UDP RX raw] {addr}: {data[:60]}")
except KeyboardInterrupt:
    print("bye")
finally:
    sock.close()