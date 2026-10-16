#!/usr/bin/env bash
# Rebuilds the TJM engine WASM bundle and syncs it to every consumer.
#
# Usage:  engine/build.sh
#
# Why a script: the bundle is produced by two steps (cargo + wasm-bindgen) with a non-default
# profile and a wasm-opt pass. PhotoCraft (MIT OR Apache-2.0) is fetched at the pinned tag into
# vendor/photocraft on first run; the bridge crate reads it by path.
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/tjm-engine-wasm" && pwd)"
ROOT_DIR="$(cd "$CRATE_DIR/../.." && pwd)"
PROFILE="wasm-release"
TARGET="wasm32-unknown-unknown"
WASM="$CRATE_DIR/target/$TARGET/$PROFILE/tjm_engine_wasm.wasm"
# Every directory that must carry an identical copy of the bundle.
CONSUMERS=("$ROOT_DIR/src/engine/pkg")
PHOTOCRAFT="$ROOT_DIR/vendor/photocraft"
PHOTOCRAFT_TAG="v0.6.0"

command -v wasm-bindgen >/dev/null || { echo "error: wasm-bindgen 0.2.129 not on PATH (cargo install wasm-bindgen-cli --version 0.2.129)" >&2; exit 1; }
if [ ! -d "$PHOTOCRAFT" ]; then
  echo "==> fetching PhotoCraft $PHOTOCRAFT_TAG"
  git clone --depth 1 --branch "$PHOTOCRAFT_TAG" https://github.com/storytold/photocraft "$PHOTOCRAFT"
fi

echo "==> cargo build --profile $PROFILE --target $TARGET"
( cd "$CRATE_DIR" && cargo build --profile "$PROFILE" --target "$TARGET" )
[ -f "$WASM" ] || { echo "error: $WASM not produced" >&2; exit 1; }

STAGE="$CRATE_DIR/target/pkg-stage"
rm -rf "$STAGE"
echo "==> wasm-bindgen --target web"
wasm-bindgen "$WASM" --out-dir "$STAGE" --target web

# wasm-opt -O3 (binaryen, pinned in package.json): ~36% smaller. -O3 rather than -Oz so pixel code stays fast.
WASM_OPT="$ROOT_DIR/node_modules/.bin/wasm-opt"
[ -x "$WASM_OPT" ] || { echo "error: $WASM_OPT missing — run npm install first" >&2; exit 1; }
echo "==> wasm-opt -O3"
"$WASM_OPT" -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
  --enable-reference-types --enable-multivalue "$STAGE/tjm_engine_wasm_bg.wasm" -o "$STAGE/tjm_engine_wasm_bg.opt.wasm"
mv "$STAGE/tjm_engine_wasm_bg.opt.wasm" "$STAGE/tjm_engine_wasm_bg.wasm"
LIMIT=$((25 * 1024 * 1024))
SIZE=$(wc -c < "$STAGE/tjm_engine_wasm_bg.wasm")
[ "$SIZE" -lt "$LIMIT" ] || { echo "error: optimised wasm is $SIZE bytes, over the 25 MiB budget" >&2; exit 1; }

for dir in "${CONSUMERS[@]}"; do
  mkdir -p "$dir"
  rm -f "$dir"/tjm_engine_wasm*
  cp "$STAGE"/tjm_engine_wasm* "$dir"/
  echo "==> synced $(basename "$(dirname "$dir")")/$(basename "$dir")"
done
rm -rf "$STAGE"

echo
echo "wasm: $(du -h "$WASM" | cut -f1) before wasm-opt, $((SIZE / 1048576)) MiB shipped  ($(wasm-bindgen --version))"
echo "Done. Run npm test and npm run smoke:demo to confirm no regression."
