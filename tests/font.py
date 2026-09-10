"""Validate the generated font in memory; never write/attach a font binary."""
from io import BytesIO
from pathlib import Path
import json
import subprocess
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
source = subprocess.run(
    ['node', '--input-type=module', '-e',
     "import {buildFont} from './packages/font/font.mjs'; process.stdout.write(Buffer.from(buildFont()));"],
    cwd=ROOT, capture_output=True, check=True, timeout=20,
).stdout
font = TTFont(BytesIO(source), checkChecksums=2)
axes = {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in font['fvar'].axes}
assert axes == {'wght': [300,400,800], 'wdth': [85,100,125]}, axes
for char in 'Landing Product Marketing ЁёжЯя0123456789':
    assert ord(char) in font.getBestCmap(), char
instances=[]
for weight,width in [(300,85),(300,125),(400,100),(520,93),(575,113),(700,110),(800,85),(800,125)]:
    instance=instantiateVariableFont(font, {'wght':weight,'wdth':width}, inplace=False)
    stream=BytesIO()
    instance.save(stream)
    loaded=TTFont(BytesIO(stream.getvalue()))
    assert len(loaded.getGlyphOrder()) == len(font.getGlyphOrder())
    for name in loaded.getGlyphOrder():
        glyph=loaded['glyf'][name]
        if glyph.numberOfContours > 0:
            assert glyph.xMax >= glyph.xMin and glyph.yMax >= glyph.yMin
    instances.append({'weight':weight,'width':width,'valid':True})
report={'mode':'FontTools in-memory generation and instancing','axes':axes,
        'glyphs':len(font.getGlyphOrder()),'instances':instances}
(ROOT/'test-results').mkdir(exist_ok=True)
(ROOT/'test-results/font-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
