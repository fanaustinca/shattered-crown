import json,urllib.request,sys
ids=sys.argv[1:]
for i in ids:
    try:
        d=json.load(urllib.request.urlopen(f'https://api.polyhaven.com/files/{i}'))
        g=d['gltf']['1k']['gltf']; tot=g['size']+sum(v['size'] for v in g['include'].values())
        info=json.load(urllib.request.urlopen(f'https://api.polyhaven.com/info/{i}'))
        print(f"{i:32s} {tot/1e6:6.1f}MB polys={info.get('polycount','?')} dims={info.get('dimensions')}")
    except Exception as e: print(i,'ERR',e)
