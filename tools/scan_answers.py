#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
תלם שלי – איפה התשובות בדף ("🙈 בלי תשובות", TS-26/27). לשיחת דפי התרגול – חלק מהנוהל של העלאת דפים חדשים.

מה זה עושה: לכל דף – מוצא את הכותרת "תשובות:" (זיהוי טקסט בעברית), ומחזיר את המלבן שמתחתיה ועד המסגרת של הדף
(בדף בלי מסגרת – עד סוף הדף). הפלט – קובץ SQL שמכניס את המלבנים ל-public.portal_ws_answers.
דף בלי "תשובות:" – לא נכנס (אין מה לכסות). דף שתוקן ידנית (found_by = 'manual') – לא נדרס.

דרוש: python3, Pillow, numpy, tesseract עם עברית:  apt-get install -y tesseract-ocr tesseract-ocr-heb ; pip install pillow numpy

הרצה:  python3 scan_answers.py pages.csv > NN.1-answer-boxes.sql
  pages.csv – שורה לכל דף: worksheet_id,path_to_image   (worksheets.id אחרי ההעלאה, והקובץ שהועלה)
  או:      python3 scan_answers.py 2401=/path/a.png 2402=/path/b.jpg > ...
בסוף הוא כותב ל-stderr סיכום: כמה נמצאו, ואילו דפים בלי "תשובות:" (לבדוק בעין שבאמת אין בהם תשובות).
"""
import sys, os, re, csv, subprocess, tempfile
import numpy as np
from PIL import Image

LABEL = re.compile(r'^תשובות:?$')

def ocr_hits(img, box, scale):
    x0, y0, x1, y1 = box
    c = img.crop(box).convert('L'); c = c.resize((c.width * scale, c.height * scale))
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f: p = f.name
    c.save(p)
    try:
        out = subprocess.run(['tesseract', p, '-', '-l', 'heb', '--psm', '11', 'tsv'], capture_output=True, text=True).stdout
    finally:
        os.unlink(p)
    hits = []
    for ln in out.splitlines()[1:]:
        f = ln.split('\t')
        if len(f) < 12 or not LABEL.match(f[11].strip()): continue
        L, T, W, H = map(int, f[6:10])
        hits.append((y0 + T / scale, y0 + (T + H) / scale))
    return hits

def find_box(path):
    img = Image.open(path).convert('RGB'); W, H = img.size
    a = np.asarray(img).astype(int); gray = a.mean(2)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 85) & (g < 70) & (b < 80) & (r - g > 45)          # המסגרת הבורדו של דפי תלם
    def dashed_above(ly0):                                       # הקו המקווקו האפור שמעל "תשובות:"
        y = int(ly0)
        for yy in range(max(0, y - 45), max(0, y - 2)):
            row = gray[yy, int(W * .1):int(W * .9)]; gr = (row > 120) & (row < 236)
            if gr.sum() > row.size * .25 and (gr[1:] != gr[:-1]).sum() > 60: return True
        return False
    hits = []
    for scale in (2, 3):                                         # כותרת קטנה – אם לא נמצאה ב-x2, מנסים x3
        hits = ocr_hits(img, (int(W * .55), int(H * .2), W, H), scale)
        if hits: break
    if not hits: return None
    good = [h for h in hits if dashed_above(h[0])]
    ly0, ly1 = min(good) if good else max(hits)                  # עם קו מקווקו – העליונה; בלי – התחתונה
    y0 = int(ly1) + 3
    rows = np.where(red.sum(1) > W * .5)[0]; below = rows[rows > y0 + 3]
    if len(below):
        y1 = int(below[0]) - 2
        xs = np.where(red[min(H - 1, y0 + 5)])[0]
        x0, x1 = (int(xs.min()) + 4, int(xs.max()) - 4) if len(xs) >= 2 and xs.max() - xs.min() > W * .5 else (int(W * .08), int(W * .92))
    else:
        x0, x1, y1 = int(W * .03), int(W * .97), H
    if y1 - y0 < 8: return None
    return [round(x0 / W, 4), round(y0 / H, 4), round(x1 / W, 4), round(y1 / H, 4)]

def main(args):
    pages = []
    for a in args:
        if '=' in a: i, p = a.split('=', 1); pages.append((int(i), p))
        else:
            for row in csv.reader(open(a, encoding='utf-8')):
                if row and row[0].strip().isdigit(): pages.append((int(row[0]), row[1].strip()))
    found, none = {}, []
    for i, p in pages:
        try: box = find_box(p)
        except Exception as e: print(f'שגיאה {i} {p}: {e}', file=sys.stderr); none.append(i); continue
        if box: found[i] = box
        else: none.append(i)
    vals = ",\n".join(f"  ({i}, {b[0]}, {b[1]}, {b[2]}, {b[3]})" for i, b in sorted(found.items()))
    print(f"""-- איפה התשובות בדפים החדשים ("🙈 בלי תשובות", TS-26/27) – נוצר ע"י telem-sheli/tools/scan_answers.py
-- {len(found)} דפים עם מלבן, {len(none)} בלי "תשובות:". אפשר להריץ שוב. דף שתוקן ידנית – לא נדרס.""")
    if found:
        print(f"""insert into public.portal_ws_answers (worksheet_id, x0, y0, x1, y1, found_by)
select v.id, v.x0, v.y0, v.x1, v.y1, 'scan'
  from (values
{vals}
  ) as v(id, x0, y0, x1, y1)
 where exists (select 1 from public.worksheets w where w.id = v.id)
on conflict (worksheet_id) do update
   set x0 = excluded.x0, y0 = excluded.y0, x1 = excluded.x1, y1 = excluded.y1, found_by = 'scan', updated_at = now()
 where public.portal_ws_answers.found_by is distinct from 'manual';""")
    print(f'נמצאו: {len(found)} · בלי "תשובות:": {len(none)} {none}', file=sys.stderr)

if __name__ == '__main__':
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    main(sys.argv[1:])
