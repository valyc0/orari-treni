#!/bin/bash
cd "$(dirname "$0")"

# Genera certificato self-signed se non esiste
if [ ! -f cert.pem ]; then
  echo "Generazione certificato HTTPS..."
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
    -subj "/CN=localhost" \
    -addext "subjectAltName=IP:$(hostname -I | awk '{print $1}'),IP:127.0.0.1,DNS:localhost" 2>/dev/null
  echo "Certificato creato."
fi

LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Server HTTPS avviato:"
echo "  https://localhost:8443"
echo "  https://${LOCAL_IP}:8443"
echo ""
echo "Prima visita: accetta l'avviso di sicurezza nel browser,"
echo "poi potrai installare l'app dalla barra degli indirizzi."
echo ""

python3 - << 'EOF'
import ssl, http.server, os

os.chdir(os.path.dirname(os.path.abspath(__file__)) if os.path.dirname(os.path.abspath(__file__)) else '.')

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args): pass  # silenzia i log

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('cert.pem', 'key.pem')

server = http.server.HTTPServer(('0.0.0.0', 8443), Handler)
server.socket = ctx.wrap_socket(server.socket, server_side=True)
server.serve_forever()
EOF

