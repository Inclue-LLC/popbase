"""
POP BASE のロゴ SVG を作る
--------------------------------------------------
ロゴの見本画像（1536×1024）の座標を測って、マークを図形で組み立てています。
文字（POP BASE）は Poppins Medium の字形を図形（パス）にしたものです（フォントがなくても表示が変わらない）。

使い方（Poppins Medium の TTF と fontTools が必要）:
  pip install fonttools
  python3 scripts/build-logo.py <Poppins-Medium.ttf>
出力: images/logo/ と images/popbase-mark.svg
"""
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'images', 'logo')
INK = '#2e2729'

# ---------- マーク（見本画像の座標。斜めの傾き 0.44 = 約 24°） ----------
SLOPE = 0.44
X0 = 271                      # 後ろの板の左端
BACK = dict(x=0, y=161, w=157, h=136)     # 傾ける前の座標（x は X0 からの距離）
FRONT = dict(x=64, y=220, w=148, h=145)   # 左端は入口の切り抜きの内側（境目に細い線が出ないように）
R = 13                        # 角の丸み
DOOR_L, DOOR_R, DOOR_TOP = 334, 389.5, 192.5    # 入口の左端は手前の板の左端と同じ   # 入口（アーチ）：画面上の座標（傾けない）
DOOR_RAD = (DOOR_R - DOOR_L) / 2
VIEW = '262 92 230 232'       # 表示範囲
SKEW = f'translate({X0} 0) matrix(1 {-SLOPE} 0 1 0 0)'


def rect(d, **attrs):
    extra = ' '.join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<rect x="{d["x"]}" y="{d["y"]}" width="{d["w"]}" height="{d["h"]}" rx="{R}" {extra}/>'


def door_path(bottom=420):
    """入口の形（上が半円、下は板の外まで伸ばす）"""
    cy = DOOR_TOP + DOOR_RAD
    return (f'M{DOOR_L} {bottom} V{cy:.2f} A{DOOR_RAD:.2f} {DOOR_RAD:.2f} 0 0 1 {DOOR_R} {cy:.2f} V{bottom} Z')


def mark_color(prefix='pb'):
    """基本のカラーのマーク（defs と図形）"""
    p = prefix
    defs = f'''
    <linearGradient id="{p}Back" gradientUnits="userSpaceOnUse" x1="275" y1="290" x2="425" y2="105">
      <stop offset="0" stop-color="#c0aff4"/>
      <stop offset=".45" stop-color="#d6bbf4"/>
      <stop offset="1" stop-color="#f0c2ee"/>
    </linearGradient>
    <linearGradient id="{p}BackFade" gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="300">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".35"/>
    </linearGradient>
    <linearGradient id="{p}Front" gradientUnits="userSpaceOnUse" x1="0" y1="135" x2="0" y2="315">
      <stop offset="0" stop-color="#fab4d2"/>
      <stop offset=".55" stop-color="#f7a5c0"/>
      <stop offset="1" stop-color="#fcd2da"/>
    </linearGradient>
    <linearGradient id="{p}Door" gradientUnits="userSpaceOnUse" x1="0" y1="195" x2="0" y2="318">
      <stop offset="0" stop-color="#fdf1f2"/>
      <stop offset=".7" stop-color="#fff6f3"/>
      <stop offset="1" stop-color="#fff6f3" stop-opacity="0"/>
    </linearGradient>
    <mask id="{p}DoorCut" maskUnits="userSpaceOnUse" x="200" y="50" width="350" height="400">
      <rect x="200" y="50" width="350" height="400" fill="#fff"/>
      <path d="{door_path()}" fill="#000"/>
    </mask>
    <clipPath id="{p}DoorClip">{rect(dict(x=0, y=161, w=212, h=204), transform=SKEW)}</clipPath>'''
    body = f'''
  <g transform="{SKEW}">
    {rect(BACK, fill=f"url(#{p}Back)")}
    {rect(BACK, fill=f"url(#{p}BackFade)")}
  </g>
  <g mask="url(#{p}DoorCut)">
    <g transform="{SKEW}">{rect(FRONT, fill=f"url(#{p}Front)", fill_opacity=".9")}</g>
  </g>
  <path d="{door_path(318)}" fill="url(#{p}Door)" clip-path="url(#{p}DoorClip)"/>'''
    return defs, body


def mark_mono(prefix='pbm', color=INK):
    """モノクロ（濃色）：2 枚の板をひとつの色で塗り、入口をくり抜く"""
    defs = f'''
    <mask id="{prefix}DoorCut" maskUnits="userSpaceOnUse" x="200" y="50" width="350" height="400">
      <rect x="200" y="50" width="350" height="400" fill="#fff"/>
      <path d="{door_path()}" fill="#000"/>
    </mask>'''
    body = f'''
  <g mask="url(#{prefix}DoorCut)" fill="{color}">
    <g transform="{SKEW}">{rect(BACK)}{rect(FRONT)}</g>
  </g>'''
    return defs, body


def mark_line(prefix='pbl', color=INK, width=6):
    """モノクロ（線）：板の輪郭と入口のアーチを線で描く"""
    w = width
    cy = DOOR_TOP + DOOR_RAD
    wide_door = f'M{DOOR_L - w} 420 V{cy:.2f} H{DOOR_L} A{DOOR_RAD:.2f} {DOOR_RAD:.2f} 0 0 1 {DOOR_R} {cy:.2f} V420 Z'
    defs = f'''
    <mask id="{prefix}DoorCut" maskUnits="userSpaceOnUse" x="200" y="50" width="350" height="400">
      <rect x="200" y="50" width="350" height="400" fill="#fff"/>
      <path d="{wide_door}" fill="#000"/>
    </mask>
    <mask id="{prefix}FrontCut" maskUnits="userSpaceOnUse" x="200" y="50" width="350" height="400">
      <rect x="200" y="50" width="350" height="400" fill="#fff"/>
      <g transform="{SKEW}">{rect(FRONT, fill="#000")}</g>
    </mask>'''
    sw = f'fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"'
    cy = DOOR_TOP + DOOR_RAD
    body = f'''
  <g mask="url(#{prefix}FrontCut)"><g mask="url(#{prefix}DoorCut)"><g transform="{SKEW}">{rect(BACK, **dict(fill="none", stroke=color, stroke_width=width))}</g></g></g>
  <g mask="url(#{prefix}DoorCut)"><g transform="{SKEW}">{rect(FRONT, **dict(fill="none", stroke=color, stroke_width=width))}</g></g>
  <path d="M{DOOR_L} {297 - SLOPE * (DOOR_L - X0) - width / 2:.2f} V{cy:.2f} A{DOOR_RAD:.2f} {DOOR_RAD:.2f} 0 0 1 {DOOR_R} {cy:.2f} V{365 - SLOPE * (DOOR_R - X0) - width / 2:.2f}" {sw} stroke-linecap="round"/>'''
    return defs, body


# ---------- 文字（POP BASE） ----------
def wordmark_path(font_path, text='POP BASE', cap_height=54.0, tracking=0.012):
    """文字を図形（パス）にする。cap_height は大文字の高さ（px）、tracking は字間（em）"""
    font = TTFont(font_path)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font['head'].unitsPerEm
    cap = getattr(font['OS/2'], 'sCapHeight', 0) or 700
    scale = cap_height / cap
    x = 0.0
    parts = []
    for ch in text:
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (scale, 0, 0, -scale, x, cap_height)))
        d = pen.getCommands()
        if d:
            parts.append(d)
        x += g.width * scale + tracking * upem * scale
    width = x - tracking * upem * scale
    return ' '.join(parts), width, cap_height


def svg(view, defs, body, title):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img" aria-label="{title}">
  <title>{title}</title>
  <defs>{defs}
  </defs>{body}
</svg>
'''


def main():
    if len(sys.argv) < 2:
        sys.exit('使い方: python3 scripts/build-logo.py <Poppins-Medium.ttf>')
    os.makedirs(OUT, exist_ok=True)
    word, ww, wh = wordmark_path(sys.argv[1])
    files = {}

    c_defs, c_body = mark_color()
    m_defs, m_body = mark_mono()
    l_defs, l_body = mark_line()
    w_defs, w_body = mark_mono('pbw', '#ffffff')

    # マークだけ
    files['popbase-mark.svg'] = svg(VIEW, c_defs, c_body, 'POP BASE')
    files['popbase-mark-mono.svg'] = svg(VIEW, m_defs, m_body, 'POP BASE')
    files['popbase-mark-line.svg'] = svg(VIEW, l_defs, l_body, 'POP BASE')
    files['popbase-mark-white.svg'] = svg(VIEW, w_defs, w_body, 'POP BASE')

    # マーク＋文字（縦組み）：マークの下に文字。見本の比率（マーク幅 約 215・文字幅 約 378）
    vx, vy, vw, vh = 262, 92, 230, 232
    gap = 22
    total_w = max(ww, vw)
    word_x = (total_w - ww) / 2
    mark_x = (total_w - vw) / 2
    pad = 16

    def stacked(defs, body, word_color):
        H = vh + gap + wh
        view = f'{-pad} {-pad} {total_w + pad * 2:.1f} {H + pad * 2:.1f}'
        b = (f'\n  <g transform="translate({mark_x - vx:.2f} {-vy})">{body}\n  </g>'
             f'\n  <path transform="translate({word_x:.2f} {vh + gap})" fill="{word_color}" d="{word}"/>')
        return svg(view, defs, b, 'POP BASE')

    files['popbase-logo.svg'] = stacked(c_defs, c_body, INK)
    files['popbase-logo-mono.svg'] = stacked(m_defs, m_body, INK)
    files['popbase-logo-line.svg'] = stacked(l_defs, l_body, INK)
    files['popbase-logo-white.svg'] = stacked(w_defs, w_body, '#ffffff')

    # マーク＋文字（横組み）：マークの右に文字（文字の高さに合わせてマークを縮める）
    def horizontal(defs, body, word_color):
        mh = wh * 1.9                      # マークの高さ
        s = mh / vh
        mw = vw * s
        g = wh * 0.45
        W = mw + g + ww
        view = f'{-pad} {-pad} {W + pad * 2:.1f} {mh + pad * 2:.1f}'
        b = (f'\n  <g transform="scale({s:.4f}) translate({-vx} {-vy})">{body}\n  </g>'
             f'\n  <path transform="translate({mw + g:.2f} {(mh - wh) / 2:.2f})" fill="{word_color}" d="{word}"/>')
        return svg(view, defs, b, 'POP BASE')

    files['popbase-logo-horizontal.svg'] = horizontal(c_defs, c_body, INK)
    files['popbase-logo-horizontal-mono.svg'] = horizontal(m_defs, m_body, INK)

    # アイコン（角丸の正方形）：グラデーション地＋白、白地＋カラー、濃色地＋白
    def icon(bg, defs, body, extra_defs=''):
        S = 512
        s = 300 / vh
        tx = (S - vw * s) / 2
        ty = (S - vh * s) / 2
        b = (f'\n  <rect width="{S}" height="{S}" rx="112" fill="{bg}"/>'
             f'\n  <g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f}) translate({-vx} {-vy})">{body}\n  </g>')
        return svg(f'0 0 {S} {S}', defs + extra_defs, b, 'POP BASE')

    grad = '''
    <linearGradient id="pbIconBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dccef5"/>
      <stop offset=".55" stop-color="#efc3e4"/>
      <stop offset="1" stop-color="#f7c9d8"/>
    </linearGradient>'''
    files['popbase-icon-gradient.svg'] = icon('url(#pbIconBg)', w_defs, w_body, grad)
    files['popbase-icon-white.svg'] = icon('#ffffff', c_defs, c_body)
    files['popbase-icon-dark.svg'] = icon(INK, w_defs, w_body)

    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w') as f:
            f.write(text)
    # サイトで使うマーク
    with open(os.path.join(ROOT, 'images', 'popbase-mark.svg'), 'w') as f:
        f.write(files['popbase-mark.svg'])
    print('\n'.join(sorted(files)))


if __name__ == '__main__':
    main()
