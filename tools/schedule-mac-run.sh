#!/usr/bin/env bash
# ============================================================================
# SCHEDULED MAC SCRAPER RUN — launchd install/uninstall/status helper
# (Node/Mac-only tooling; never ships to the phone)
# ============================================================================
#
# Installs a per-user launchd agent that runs the full parser sweep daily via
# tools/run-once.js with the shared Mac↔phone storage root active:
#
#   - CHUNKY_SHARED_STORAGE_DIR points at the phone's chunky-dad-scraper tree
#     (iCloud Scriptable Documents), so the Mac run shares the phone's
#     page/OCR/AI caches and writes its run JSON + log into the shared runs/
#     and logs/ dirs (phone naming: YYYYMMDD-HHMMSS). Retention pruning is
#     never performed by the Mac — the phone owns deletion.
#   - CHUNKY_RUN_AUTOMATION=1 makes the sweep behave like the phone's
#     scheduled automation runs: parsers with automationEnabled: false are
#     skipped.
#   - Runs are DRY-RUN (run-once forces it): the phone remains the ONLY
#     calendar writer.
#   - If the shared root is unreachable (iCloud signed out, wrong path) the
#     run ABORTS LOUDLY at startup instead of degrading to a local cache —
#     check ~/Library/Logs/chunky-dad-scraper/scheduled-run.err.log.
#
# RECOMMENDED CADENCE: daily (the default). Additionally, after script
# updates that change AI/OCR prompts, run one MANUAL warm run — prompt
# changes rotate the AI cache keys, so the first post-update sweep re-pays
# every AI call; warming it on the Mac (mains power, no iOS time limits)
# means the phone's next run hits the fresh shared entries instead:
#
#   CHUNKY_SHARED_STORAGE_DIR="$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/chunky-dad-scraper" \
#   CHUNKY_RUN_AUTOMATION=1 node tools/run-once.js
#
# USAGE:
#   tools/schedule-mac-run.sh install [--hour H] [--minute M] [--shared-dir PATH] [--node PATH]
#   tools/schedule-mac-run.sh uninstall
#   tools/schedule-mac-run.sh status
#
# DEFAULTS: hour 05, minute 15, shared dir = the real iCloud Scriptable tree,
# node = `command -v node` at install time (baked in absolute — launchd's PATH
# is minimal).
# ============================================================================

set -euo pipefail

LABEL="com.chunky-dad.scraper-daily"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${SCRIPT_DIR}/launchd/${LABEL}.plist.template"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LAUNCHD_LOG_DIR="${HOME}/Library/Logs/chunky-dad-scraper"
DEFAULT_SHARED_DIR="${HOME}/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/chunky-dad-scraper"

usage() {
    sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
}

require_template() {
    if [[ ! -f "${TEMPLATE}" ]]; then
        echo "ERROR: plist template not found at ${TEMPLATE}" >&2
        exit 1
    fi
}

# XML-escape for plist string values (paths can contain & etc.).
xml_escape() {
    local s="$1"
    s="${s//&/&amp;}"
    s="${s//</&lt;}"
    s="${s//>/&gt;}"
    printf '%s' "$s"
}

cmd_install() {
    local hour=5 minute=15 shared_dir="${DEFAULT_SHARED_DIR}" node_bin=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --hour) hour="$2"; shift 2 ;;
            --minute) minute="$2"; shift 2 ;;
            --shared-dir) shared_dir="$2"; shift 2 ;;
            --node) node_bin="$2"; shift 2 ;;
            *) echo "Unknown option: $1" >&2; usage ;;
        esac
    done

    if ! [[ "${hour}" =~ ^[0-9]+$ ]] || (( hour < 0 || hour > 23 )); then
        echo "ERROR: --hour must be 0-23 (got: ${hour})" >&2; exit 1
    fi
    if ! [[ "${minute}" =~ ^[0-9]+$ ]] || (( minute < 0 || minute > 59 )); then
        echo "ERROR: --minute must be 0-59 (got: ${minute})" >&2; exit 1
    fi

    if [[ -z "${node_bin}" ]]; then
        node_bin="$(command -v node || true)"
    fi
    if [[ -z "${node_bin}" || ! -x "${node_bin}" ]]; then
        echo "ERROR: node binary not found (pass --node /path/to/node)" >&2; exit 1
    fi

    # Same no-partial-runs stance as the runtime: refuse to install pointing
    # at a tree that does not look like the phone's chunky-dad-scraper dir.
    if [[ ! -d "${shared_dir}/storage" ]]; then
        echo "ERROR: ${shared_dir} has no storage/ subtree — expected the phone's chunky-dad-scraper directory (iCloud signed out? wrong path?)" >&2
        exit 1
    fi

    require_template
    mkdir -p "${HOME}/Library/LaunchAgents" "${LAUNCHD_LOG_DIR}"

    local esc_node esc_repo esc_shared esc_logs
    esc_node="$(xml_escape "${node_bin}")"
    esc_repo="$(xml_escape "${REPO_ROOT}")"
    esc_shared="$(xml_escape "${shared_dir}")"
    esc_logs="$(xml_escape "${LAUNCHD_LOG_DIR}")"

    sed \
        -e "s|__LABEL__|${LABEL}|g" \
        -e "s|__NODE__|${esc_node}|g" \
        -e "s|__REPO__|${esc_repo}|g" \
        -e "s|__SHARED_DIR__|${esc_shared}|g" \
        -e "s|__HOUR__|${hour}|g" \
        -e "s|__MINUTE__|${minute}|g" \
        -e "s|__LAUNCHD_LOG_DIR__|${esc_logs}|g" \
        "${TEMPLATE}" > "${PLIST_PATH}"

    plutil -lint "${PLIST_PATH}" >/dev/null

    # Reinstall-safe: boot out any previous copy, then bootstrap the new one.
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"

    echo "Installed ${LABEL}:"
    echo "  runs daily at $(printf '%02d:%02d' "${hour}" "${minute}") (local time)"
    echo "  program:     /bin/zsh (TCC responsible process; node runs as its child)"
    echo "  node:        ${node_bin}"
    echo "  repo:        ${REPO_ROOT}"
    echo "  shared dir:  ${shared_dir}"
    echo "  launchd log: ${LAUNCHD_LOG_DIR}/scheduled-run.{out,err}.log"
    echo "  per-run log: ${shared_dir}/logs/<YYYYMMDD-HHMMSS>.log (written by run-once)"
    echo "ONE-TIME PERMISSION (survives node upgrades): System Settings → Privacy &"
    echo "Security → Full Disk Access → add /bin/zsh (⌘⇧G to type the path). Without"
    echo "it, launchd runs hang reading the iCloud shared cache (proven 2026-08-12)."
    echo "Reminder: after prompt-changing script updates, do one manual warm run (see header)."
}

cmd_uninstall() {
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    if [[ -f "${PLIST_PATH}" ]]; then
        rm "${PLIST_PATH}"
        echo "Removed ${PLIST_PATH}"
    else
        echo "No plist at ${PLIST_PATH} (nothing to remove)"
    fi
    echo "Uninstalled ${LABEL} (launchd job booted out if it was loaded)."
}

cmd_status() {
    if [[ -f "${PLIST_PATH}" ]]; then
        echo "plist: ${PLIST_PATH}"
    else
        echo "plist: NOT INSTALLED (${PLIST_PATH})"
    fi
    if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
        echo "launchd: loaded"
        launchctl print "gui/$(id -u)/${LABEL}" | grep -E "state|last exit code|runs" | sed 's/^/  /' || true
    else
        echo "launchd: not loaded"
    fi
    if [[ -f "${LAUNCHD_LOG_DIR}/scheduled-run.err.log" ]]; then
        echo "recent stderr (${LAUNCHD_LOG_DIR}/scheduled-run.err.log):"
        tail -n 5 "${LAUNCHD_LOG_DIR}/scheduled-run.err.log" | sed 's/^/  /'
    fi
}

case "${1:-}" in
    install) shift; cmd_install "$@" ;;
    uninstall) cmd_uninstall ;;
    status) cmd_status ;;
    *) usage ;;
esac
