#!/bin/bash
cd "$(dirname "$0")"
PORT=${1:-8080}
echo "▶ Avvio orari-treni-react su http://localhost:$PORT"
PORT=$PORT npm run dev
