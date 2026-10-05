#!/bin/bash
# Серверные метрики раз в ~10 с → $1 (JSONL). Останавливается файлом $1.stop.
OUTF=$1
cd /root/znat
P=$(grep ^REDIS_PASSWORD= .env | cut -d= -f2-)
while [ ! -f "$OUTF.stop" ]; do
  T=$(date +%s%3N)
  LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
  STATS=$(docker stats --no-stream --format '{{.Name}}={{.CPUPerc}}={{.MemUsage}}' 2>/dev/null | grep -E '^(znat-(livekit|app|postgres|redis|caddy|coturn)-1|cls-)' | sed 's/ \/ [^=]*$//' | tr '\n' ';')
  REDIS=$(docker exec znat-redis-1 redis-cli -a "$P" --no-auth-warning info 2>/dev/null | grep -E '^(used_memory|connected_clients|instantaneous_ops_per_sec):' | tr -d '\r' | tr '\n' ';')
  PG=$(docker exec znat-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*)||\$\$/\$\$||count(*) filter (where state=\$\$active\$\$)||\$\$/\$\$||coalesce(round(max(extract(epoch from now()-query_start)) filter (where state=\$\$active\$\$)*1000),0) from pg_stat_activity where datname=current_database()"' 2>/dev/null)
  APPM=$(docker exec znat-app-1 node -e "fetch('http://127.0.0.1:3000/metrics').then(r=>r.text()).then(t=>{const g=n=>{const l=t.split('\n').find(x=>x.startsWith(n+' ')||x.startsWith(n+'{'));return l?l.split(' ').pop():null};console.log([g('nodejs_eventloop_lag_p99_seconds'),g('nodejs_eventloop_lag_max_seconds'),t.split('\n').filter(x=>x.startsWith('db_pool_connections')).map(x=>x.replace('db_pool_connections','')).join(','),g('process_resident_memory_bytes'),g('nodejs_heap_size_used_bytes')].join('|'))})" 2>/dev/null)
  APPM=$(echo "$APPM" | tr "\"" "'")
  MEM=$(free -m | awk '/Mem:/{print $3"/"$2} /Swap:/{print "swap "$3}' | tr '\n' ' ')
  printf '{"t":%s,"load":"%s","mem":"%s","docker":"%s","redis":"%s","pg":"%s","app":"%s"}\n' "$T" "$LOAD" "$MEM" "$STATS" "$REDIS" "$PG" "$APPM" >> "$OUTF"
  sleep 7
done
