#!/bin/bash
for i in "$@"; do
  f=$(curl -s -A 'shattered-crown-build' "https://api.polyhaven.com/files/$i")
  inf=$(curl -s -A 'shattered-crown-build' "https://api.polyhaven.com/info/$i")
  python3 -c "
import json,sys
d=json.loads(sys.argv[1]); inf=json.loads(sys.argv[2])
g=d['gltf']['1k']['gltf']; t=g['size']+sum(v['size'] for v in g['include'].values())
print(f\"{sys.argv[3]:28s} {t/1e6:6.1f}MB polys={inf.get('polycount','?')} dims={inf.get('dimensions')}\")" "$f" "$inf" "$i" 2>/dev/null || echo "$i ERR"
done
