import socket, ssl, sys
ca, ip = sys.argv[1], sys.argv[2]
def check(name):
    ctx = ssl.create_default_context(cafile=ca)
    try:
        with socket.create_connection(("127.0.0.1", 8443), timeout=5) as s:
            with ctx.wrap_socket(s, server_hostname=name) as t:
                return "OK  " + t.version() + " " + t.cipher()[0]
    except Exception as e:
        return "FAIL " + type(e).__name__ + ": " + str(e)[:80]
for n in (ip, "kalyan-server", "localhost", "127.0.0.1", "192.168.1.100", "other-host"):
    print(f"{n:16} -> {check(n)}")
