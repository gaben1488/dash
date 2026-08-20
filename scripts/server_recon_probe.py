"""server_recon_probe.py — диагностика ШДЮ-сверки на проде (read-only).

SSH → читает AEMR_API_KEY из deploy/.env.production → curl /api/reconciliation/monthly
→ суммирует server-side: counts, распределение rootCause среди расхождений, сколько
расхождений БЕЗ объяснения (rootCause undefined), топ типов ячеек. Большой JSON не тащим.
"""
import sys, os, paramiko
sys.stdout.reconfigure(encoding='utf-8')

HOST = '193.233.244.217'
USER = os.environ.get('AEMR_SRV_USER', 'aemr')
# Выделенный деплой-ключ, НЕ личный id_ed25519 (правило: личный ключ не для деплоя;
# шов 12 реестра швов 09.07.2026 — здесь он оставался последним).
KEY = os.path.expanduser(os.environ.get('AEMR_SSH_KEY', '~/.ssh/aemr_deploy'))

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, key_filename=KEY, timeout=20, allow_agent=False, look_for_keys=False)

PROBE = r'''
KEY=$(grep -E '^AEMR_API_KEY=' /home/aemr/dash/deploy/.env.production | cut -d= -f2- | tr -d '"' | tr -d "'")
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1/api/reconciliation/monthly > /tmp/recon.json
echo "json bytes: $(wc -c < /tmp/recon.json)"
python3 - <<'PY'
import json
from collections import Counter
try:
    d=json.load(open('/tmp/recon.json'))
except Exception as ex:
    print("PARSE FAIL:", ex); print(open('/tmp/recon.json').read()[:400]); raise SystemExit
print('overallStatus:', d.get('overallStatus'))
print('warning field:', d.get('warning'))
print('counts:', d.get('counts'))
rows=d.get('rows',[])
print('total rows:', len(rows))
maincells=['compPlan','compFact','compPlanTotal','compFactTotal','epPlan','epFact','epPlanTotal','epFactTotal']
rc=Counter(); conf=Counter(); unexplained=0; mismatched=0; cellmis=Counter(); cellcount=Counter()
for r in rows:
    has=False
    for k in maincells:
        cc=r.get(k)
        if isinstance(cc,dict) and cc.get('status') in ('warning','high'):
            has=True; cellmis[k]+=1; cellcount[cc['status']]+=1
    for bk in ('compBudget','epBudget'):
        b=r.get(bk) or {}
        for k,cc in b.items():
            if isinstance(cc,dict) and cc.get('status') in ('warning','high'):
                has=True; cellmis['budget:'+k]+=1; cellcount[cc['status']]+=1
    if has:
        mismatched+=1
        if r.get('rootCause'):
            rc[r['rootCause']['id']]+=1; conf[r['rootCause'].get('confidence')]+=1
        else:
            unexplained+=1
print('mismatched ROWS:', mismatched)
print('mismatched CELLS by status:', dict(cellcount))
print('rootCause distribution (rows):', dict(rc))
print('confidence dist:', dict(conf))
print('UNEXPLAINED mismatched rows (rootCause=undefined):', unexplained)
print('top mismatched cell-types:', dict(cellmis.most_common(14)))
PY
'''
_, o, e = c.exec_command(PROBE, timeout=90)
print(o.read().decode('utf-8', 'replace'))
err = e.read().decode('utf-8', 'replace')
if err.strip():
    print('STDERR:', err[-1500:])
c.close()
