#!/bin/sh
# Vergleicht den Produktions-Ist-Zustand mit der Baseline vom Auftragsbeginn
# (docs/easy-onboarding/baseline-produktion.txt). Nur lesend. Abnahmekriterium 6.
set -e
echo "# Produktions-Kontrolle $(date -u +%FT%TZ)"
echo "## pm2"
pm2 jlist | python3 -c "import json,sys; [print(p['name'],'pid',p['pid'],'restarts',p['pm2_env']['restart_time'],'status',p['pm2_env']['status']) for p in json.load(sys.stdin)]"
echo "## /root/panel-live sha256"
sha256sum /root/panel-live/*
echo "## /root/mcp-live dist mtime + HEAD"
stat -c '%y %n' /root/mcp-live/dist/index.js
git -C /root/mcp-live rev-parse HEAD
git -C /root/mcp-live status --short | wc -l
echo "## prod db"
stat -c '%y %s %n' /root/mcp-server/data/panel.db
python3 -c "
import sqlite3; c=sqlite3.connect('file:/root/mcp-server/data/panel.db?mode=ro',uri=True)
print('customers', c.execute('select count(*) from customers').fetchone()[0], 'planned', c.execute('select count(*) from planned_posts').fetchone()[0], 'cols', len(c.execute('pragma table_info(customers)').fetchall()))
print('start_previews table exists:', bool(c.execute(\"select name from sqlite_master where name='start_previews'\").fetchone()))"
