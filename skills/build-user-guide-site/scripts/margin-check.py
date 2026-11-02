import glob,sys
from PIL import Image
import numpy as np
def first(lines):
    for i,l in enumerate(lines):
        if (np.abs(l-np.median(l))>40).mean()>0.004: return i/2
    return len(lines)/2
rows=[]
for f in sorted(glob.glob('website/src/assets/shots/**/*.webp',recursive=True)):
    a=np.asarray(Image.open(f).convert('L')).astype(int);h,w=a.shape
    m=dict(t=first(a),b=first(a[::-1]),l=first(a.T),r=first(a.T[::-1]))
    rows.append((f.split('shots/')[1],w//2,h//2,m))
th=float(sys.argv[1]) if len(sys.argv)>1 else 6
bad=[r for r in rows if min(r[3].values())<th]
print(len(rows),len(bad))
for n,w,h,m in bad: print(f"{n:48}{w:5}x{h:<5}"," ".join(f"{k}{v:g}" for k,v in m.items()))
