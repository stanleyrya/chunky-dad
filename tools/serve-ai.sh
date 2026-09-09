#!/usr/bin/env bash
# ============================================================================
# serve-ai.sh — start the scraper's two local AI servers with verified flags
# ============================================================================
# The scraper needs a TEXT model on :8000 (extraction, context-prep,
# classify-page, merge-arbitration, bear-check, field-trim, short-name,
# segment-boundaries) and a VISION model on :8001 (ocr / ocr-all). Both are
# hand-started on rybook; nothing supervises them.
#
#   tools/serve-ai.sh            start both (no-op if already healthy)
#   tools/serve-ai.sh status     health + the flags each one is running
#   tools/serve-ai.sh stop       stop both
#   tools/serve-ai.sh restart    stop, then start
#
# ---------------------------------------------------------------------------
# WHY THESE FLAGS — three of them are load-bearing and were learned the hard way
# ---------------------------------------------------------------------------
# 1. NO --kv-cache-quantization. It is now a HARD ERROR on both models
#    (KVCacheQuantizationUnsupportedError: hybrid/ArraysCache on the text
#    model, "the multimodal serving lane has no quantized KV-cache path" on the
#    vision one). It exits code 3 *after* the model finishes loading, so it
#    looks like a startup hang rather than a bad flag. bf16 is the default.
#
# 2. --host <tailnet ip>. rapid-mlx now defaults to 127.0.0.1, so a server that
#    starts perfectly is still unreachable from the phone. Bind the TAILNET
#    address, not 0.0.0.0 — 0.0.0.0 would also expose the model on WiFi/LAN.
#
#    (1) and (2) together took the scraper's AI out for four days in September
#    2026: 1381/1381 AI calls failed per run, and every run still reported
#    success. The orchestrator now prints "AI DEGRADED RUN" when that happens.
#
# 3. --default-repetition-penalty 1.15 on the VISION server. Measured, not
#    taste: the vision model falls into repetition loops ("NEED A TICKET?" then
#    hundreds of newlines) that burn the token budget and truncate the JSON.
#    On 30 real OCR cases this took failures from 16.7% to 0% AND ran 2.5x
#    faster. Do not drop it. It is vision-only — on the text model the same
#    penalty measured no better.
#
# --max-num-seqs 1 is deliberate: batching was measured and does NOT help
# (121s wall at concurrency 1, 146s at 4, 130s at 8 — one request already
# saturates the GPU). Verify any of this with `node tools/ai-eval.js`.
# ============================================================================

set -u

TEXT_MODEL="lmstudio-community/Qwen3-Coder-Next-MLX-6bit"
VISION_MODEL="mlx-community/Qwen3-VL-4B-Instruct-4bit"
TEXT_PORT=8000
VISION_PORT=8001
LOG_DIR="${TMPDIR:-/tmp}"

# Downloading a model? Xet storage stalls indefinitely on this machine (the
# byte counter freezes, sometimes runs backwards) and two concurrent pulls
# deadlock. Export this and pull ONE at a time:
#   HF_HUB_DISABLE_XET=1 rapid-mlx pull <alias>

tailnet_ip () {
  local ts=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  if [ -x "$ts" ]; then "$ts" ip -4 2>/dev/null | head -1; fi
}

HOST_IP="$(tailnet_ip)"
if [ -z "$HOST_IP" ]; then
  echo "Could not read the Tailscale IP (is Tailscale running?)." >&2
  echo "The scraper reaches these servers over the tailnet, so a loopback bind is useless to it." >&2
  exit 1
fi

port_pid () { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

health () { curl -s -m 3 "http://${HOST_IP}:$1/health" 2>/dev/null; }

wait_healthy () {
  local port="$1" want="$2" log="$3" i
  for i in $(seq 1 300); do
    health "$port" | grep -q "$want" && return 0
    if grep -qE "Application startup failed|already in use" "$log" 2>/dev/null; then
      echo "  FAILED to start on :$port —" >&2
      grep -E "Error|error:" "$log" | tail -3 >&2
      return 1
    fi
    sleep 5
  done
  echo "  timed out waiting for :$port (see $log)" >&2
  return 1
}

start_text () {
  if [ -n "$(port_pid "$TEXT_PORT")" ]; then echo "  :$TEXT_PORT already listening"; return 0; fi
  echo "  starting text model on :$TEXT_PORT ..."
  rapid-mlx --no-banner serve "$TEXT_MODEL" \
    --host "$HOST_IP" --port "$TEXT_PORT" \
    --prefill-step-size 4096 \
    --gpu-memory-utilization 0.90 \
    --max-num-seqs 1 \
    --pin-system-prompt \
    --max-tokens 131072 \
    --tool-call-parser qwen3_coder_xml \
    --enable-auto-tool-choice \
    --reasoning-parser qwen3 \
    > "$LOG_DIR/rapid-mlx-text.log" 2>&1 &
  wait_healthy "$TEXT_PORT" "Coder-Next" "$LOG_DIR/rapid-mlx-text.log"
}

start_vision () {
  if [ -n "$(port_pid "$VISION_PORT")" ]; then echo "  :$VISION_PORT already listening"; return 0; fi
  echo "  starting vision model on :$VISION_PORT ..."
  rapid-mlx --no-banner serve "$VISION_MODEL" \
    --host "$HOST_IP" --port "$VISION_PORT" \
    --prefill-step-size 4096 \
    --gpu-memory-utilization 0.30 \
    --max-num-seqs 1 \
    --pin-system-prompt \
    --max-tokens 131072 \
    --default-repetition-penalty 1.15 \
    --reasoning-parser qwen3 \
    > "$LOG_DIR/rapid-mlx-vision.log" 2>&1 &
  wait_healthy "$VISION_PORT" "Qwen3-VL" "$LOG_DIR/rapid-mlx-vision.log"
}

stop_port () {
  local pid; pid="$(port_pid "$1")"
  if [ -z "$pid" ]; then echo "  :$1 not running"; return 0; fi
  kill "$pid" 2>/dev/null
  local i
  for i in $(seq 1 30); do
    [ -z "$(port_pid "$1")" ] && { echo "  :$1 stopped"; return 0; }
    sleep 2
  done
  echo "  :$1 would not stop (pid $pid)" >&2; return 1
}

show_status () {
  local port label pid
  for port in "$TEXT_PORT" "$VISION_PORT"; do
    [ "$port" = "$TEXT_PORT" ] && label=text || label=vision
    pid="$(port_pid "$port")"
    if [ -z "$pid" ]; then
      echo "  $label :$port — NOT RUNNING"
    else
      echo "  $label :$port — $(health "$port")"
      ps -o args= -p "$pid" 2>/dev/null | sed 's|.*rapid-mlx|      rapid-mlx|' | cut -c1-160
    fi
  done
}

case "${1:-start}" in
  start)
    echo "Binding to tailnet ${HOST_IP} (the address the scraper uses)"
    start_text || exit 1
    start_vision || exit 1
    echo "Both servers healthy."
    ;;
  stop)    stop_port "$TEXT_PORT"; stop_port "$VISION_PORT" ;;
  restart) stop_port "$TEXT_PORT"; stop_port "$VISION_PORT"; exec "$0" start ;;
  status)  show_status ;;
  *) echo "usage: $0 [start|stop|restart|status]" >&2; exit 2 ;;
esac
