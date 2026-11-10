#!/bin/sh
# フロントエンド(frontend/ → frontend/dist/)をビルドして、Go のバイナリまで作る
set -e
cd "$(dirname "$0")"

if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend install
fi
npm --prefix frontend run build

go build -o jiyucho.exe .
echo "built: jiyucho.exe"
