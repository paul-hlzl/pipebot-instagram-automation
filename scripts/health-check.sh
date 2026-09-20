#!/bin/bash
# Health check for the instagram-mcp pm2 process behind Nginx at mcp.pipebot.at.
#
# 20.09.2026: Diese Datei ist die EINZIGE Quelle. /root/scripts/health-check.sh ist nur noch ein
# Symlink hierher - vorher lag das Skript unversioniert unter /root/scripts und war allein durch
# eine .bak-Datei geschuetzt. Der Cron-Eintrag zeigt weiter auf den alten Pfad, aendert sich also
# nicht. Log und Statusdatei bleiben bewusst unter /root/scripts (gehoeren nicht ins Repo, und die
# bisherige Historie bleibt so erhalten).
#
# ACHTUNG: Wer in diesem Arbeitsbaum den Branch wechselt und die Datei damit verschwinden laesst,
# legt die Ueberwachung still - der Cron-Lauf schlaegt dann stumm fehl. Rueckfallkopie:
# /root/scripts/health-check.sh.bak-20260920
#
# Run via cron every 30 minutes. Emails office@pipebot.at only on a status
# CHANGE (OK->FAILED or FAILED->OK), not on every failed run, to avoid spam
# during a prolonged outage.

set -u

PM2_NAME="instagram-mcp"
HEALTH_URL="https://mcp.pipebot.at/health"
# 20.09.2026: Der Name, unter dem die Routine uns erreicht, und die IP, auf die er zeigen MUSS.
# Siehe DNS-Check weiter unten.
DNS_NAME="mcp.pipebot.at"
DNS_ZONE="pipebot.at"
DNS_EXPECTED_IP="2.29.38.44"
LOG_FILE="/root/scripts/health-check.log"
STATUS_FILE="/root/scripts/health-check-status.txt"
MAIL_TO="office@pipebot.at"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

log() {
    echo -e "${TIMESTAMP}\t$1" >> "$LOG_FILE"
}

send_mail() {
    # $1 = subject, $2 = body
    {
        echo "From: Pipeline MCP Health-Check <office@pipebot.at>"
        echo "To: ${MAIL_TO}"
        echo "Subject: $1"
        echo "Content-Type: text/plain; charset=UTF-8"
        echo ""
        echo -e "$2"
    } | msmtp -a pipebot -t 2>>"$LOG_FILE"
}

FAIL_REASONS=()

# 1. pm2 process check
PM2_STATUS="$(pm2 jlist 2>/dev/null | jq -r --arg name "$PM2_NAME" '.[] | select(.name==$name) | .pm2_env.status' 2>/dev/null)"

if [ -z "$PM2_STATUS" ]; then
    FAIL_REASONS+=("pm2-Prozess '$PM2_NAME' nicht gefunden (pm2 jlist lieferte keinen Eintrag)")
elif [ "$PM2_STATUS" != "online" ]; then
    FAIL_REASONS+=("pm2-Prozess '$PM2_NAME' Status ist '$PM2_STATUS' (erwartet: online)")
fi

# 2. HTTP check against the server's own unauthenticated health endpoint
HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)"
CURL_EXIT=$?

if [ "$CURL_EXIT" -ne 0 ]; then
    FAIL_REASONS+=("HTTP-Check gegen $HEALTH_URL fehlgeschlagen (curl exit code $CURL_EXIT, z.B. Timeout/Connection refused)")
elif [ "$HTTP_CODE" != "200" ]; then
    FAIL_REASONS+=("HTTP-Check gegen $HEALTH_URL lieferte HTTP $HTTP_CODE (erwartet: 200)")
fi

# 3. DNS-Check gegen den AUTORITATIVEN Nameserver.
#
# Warum nicht einfach der normale Resolver: Am 20.09.2026 war der A-Record von mcp.pipebot.at
# ab 12:45 weg - die Routine kam nicht mehr durch. Dieser Check meldete um 13:00 trotzdem
# http=200, weil der Server den alten Record noch im eigenen Cache hatte (TTL 7200). Erst um
# 13:30, nach Ablauf des Caches, schlug curl an. 45 Minuten blind.
#
# Der autoritative Server hat keinen Cache. Er haette den Ausfall sofort gezeigt.
# Ein Fehlschlag wird EINMAL wiederholt, damit ein einzelner Netz-Schluckauf keinen Alarm ausloest.
dns_a_record() {
    local ns
    ns="$(dig +short NS "$DNS_ZONE" 2>/dev/null | head -1)"
    if [ -n "$ns" ]; then
        dig +short +time=5 +tries=1 @"$ns" "$DNS_NAME" A 2>/dev/null | grep -E '^[0-9.]+$' | tail -1
    else
        # Notnagel: die Zone selbst ist nicht auffloesbar - dann wenigstens normal fragen.
        dig +short +time=5 +tries=1 "$DNS_NAME" A 2>/dev/null | grep -E '^[0-9.]+$' | tail -1
    fi
}

DNS_IP="$(dns_a_record)"
if [ -z "$DNS_IP" ] || [ "$DNS_IP" != "$DNS_EXPECTED_IP" ]; then
    sleep 3
    DNS_IP="$(dns_a_record)"
fi

if [ -z "$DNS_IP" ]; then
    FAIL_REASONS+=("DNS: ${DNS_NAME} hat beim autoritativen Nameserver KEINEN A-Record - von aussen ist der Dienst nicht erreichbar, auch wenn er hier laeuft")
elif [ "$DNS_IP" != "$DNS_EXPECTED_IP" ]; then
    FAIL_REASONS+=("DNS: ${DNS_NAME} zeigt beim autoritativen Nameserver auf ${DNS_IP} statt auf ${DNS_EXPECTED_IP}")
fi

if [ ${#FAIL_REASONS[@]} -eq 0 ]; then
    CURRENT_STATUS="OK"
else
    CURRENT_STATUS="FAILED"
fi

# Previous status (first-ever run: assume OK so we don't alarm-mail immediately
# just because the status file doesn't exist yet)
if [ -f "$STATUS_FILE" ]; then
    PREVIOUS_STATUS="$(cat "$STATUS_FILE")"
else
    PREVIOUS_STATUS="OK"
fi

DETAILS="$(printf '%s\n' "${FAIL_REASONS[@]:-}")"

if [ "$CURRENT_STATUS" = "OK" ]; then
    log "OK\tpm2 status=${PM2_STATUS}, http=${HTTP_CODE}, dns=${DNS_IP} (vorher: ${PREVIOUS_STATUS})"
else
    log "FAIL\t${DETAILS//$'\n'/ | } (vorher: ${PREVIOUS_STATUS})"
fi

if [ "$PREVIOUS_STATUS" = "OK" ] && [ "$CURRENT_STATUS" = "FAILED" ]; then
    BODY="Health-Check für instagram-mcp (mcp.pipebot.at) ist fehlgeschlagen.\n\nZeitpunkt (UTC): ${TIMESTAMP}\n\nGefundene Probleme:\n${DETAILS}\n\npm2-Status (roh): ${PM2_STATUS:-<leer/nicht gefunden>}\nHTTP-Statuscode: ${HTTP_CODE:-<kein Code, curl exit ${CURL_EXIT}>}\nA-Record laut autoritativem NS: ${DNS_IP:-<keiner>} (erwartet: ${DNS_EXPECTED_IP})\n\nDies ist eine automatische Mail vom Health-Check-Skript (/root/scripts/health-check.sh, läuft alle 30 Minuten via cron). Solange der Ausfall anhält, kommt keine weitere Mail - erst wieder bei Wiederherstellung."
    send_mail "WARNUNG: instagram-mcp Health-Check FAILED" "$BODY" \
        && log "MAIL_SENT\tAlarm-Mail an ${MAIL_TO} verschickt (Statuswechsel OK->FAILED)" \
        || log "MAIL_FAILED\tmsmtp-Aufruf (Alarm) schlug fehl, siehe $LOG_FILE"
elif [ "$PREVIOUS_STATUS" = "FAILED" ] && [ "$CURRENT_STATUS" = "OK" ]; then
    BODY="instagram-mcp (mcp.pipebot.at) ist wieder erreichbar.\n\nZeitpunkt (UTC): ${TIMESTAMP}\n\npm2-Status: ${PM2_STATUS}\nHTTP-Statuscode: ${HTTP_CODE}\n\nDies ist eine automatische Mail vom Health-Check-Skript (/root/scripts/health-check.sh). Der vorherige Ausfall hat sich also entweder von selbst gelöst oder wurde behoben."
    send_mail "✅ instagram-mcp wieder erreichbar" "$BODY" \
        && log "MAIL_SENT\tWiederherstellungs-Mail an ${MAIL_TO} verschickt (Statuswechsel FAILED->OK)" \
        || log "MAIL_FAILED\tmsmtp-Aufruf (Wiederherstellung) schlug fehl, siehe $LOG_FILE"
else
    log "NO_STATUS_CHANGE\tStatus bleibt ${CURRENT_STATUS}, keine Mail"
fi

echo -n "$CURRENT_STATUS" > "$STATUS_FILE"

[ "$CURRENT_STATUS" = "OK" ] && exit 0 || exit 1
