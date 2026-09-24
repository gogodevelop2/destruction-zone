// 원본 DZONE.EXE 가 화면 메모리에 직접 쓰는 세 함수 재구현.
//
//   0x04F0B  rectOutline       상자의 네 변을 그린다
//   0x04FF1  rowRun            가로줄 하나를 그린다 (x0 부터 x0+len 까지, 양 끝 포함)
//   0x05041  columnRun         세로줄 하나를 그린다
//   0x050EE  drawChar          글자 하나를 5x7 격자로 펴서 그린다
//   0x04E5C  panelFill         테두리 둘과 안쪽을 칠한 상자
//   0x051A8  drawString        글자를 6칸 간격으로 늘어놓는다
//   0x051E0  drawNumber        long 을 오른쪽 맞춤으로 쓴다
//   0x05091  labelledPanel     상자 + 이름 + 숫자
//   0x052BE  textInputPrompt   이름을 입력받는다
//
// 바이트 근거는 disasm/ 의 같은 이름 파일들에 있다. 정답표는 goldens/vram_vectors_v1 이고
// port/test/vram.test.ts 가 그것으로 판정한다.
//
// 이 셋은 BGI 드라이버를 안 거치고 게임 본체가 직접 VGA 에 쓴다. 게임에는 그리는 길이
// 둘인데, 게임플레이 화면은 BGI 드라이버(.GDA)를 쓰고 메뉴·상점·설정 화면은 이 길을
// 쓴다. 그래서 여기 세 함수는 analysis/graphics_bgi.md 의 진입점 표와 아무 상관이 없다.
// @원본 0x04F0B 0x04FF1 0x05041 0x050EE 0x04E5C 0x051A8 0x051E0 0x05091 0x052BE

import { readFileSync } from "../../web/shim.js";
import { fileURLToPath } from "../../web/shim.js";
import { drawGlyph } from "./text.js";

const i16 = (v        )         => (v << 16) >> 16;
const u16 = (v        )         => v & 0xffff;
const sbyte = (v        )         => (v << 24) >> 24;

/** 평면 하나의 크기. 원본이 오프셋을 16비트로 계산하므로 이 밖에는 쓸 수가 없다. */
export const PLANE_BYTES = 0x10000;

/** 한 줄이 차지하는 바이트 수. 원본이 `mov ax,0x50` 으로 박아 넣은 값이다. */
export const BYTES_PER_ROW = 0x50;

/**
 * 평면 넷을 이어 붙인 화면 메모리. `vram[plane * PLANE_BYTES + offset]` 이 한 바이트다.
 *
 * 원본은 VGA 를 unchained (Mode X) 로 두고 쓴다. 그 방식에서는 픽셀 하나가 바이트
 * 하나이고, 가로로 이웃한 네 픽셀이 평면 넷에 하나씩 흩어진다.
 */
                              

export function newVram(fill = 0)       {
  return new Uint8Array(4 * PLANE_BYTES).fill(fill);
}

/**
 * 픽셀 하나를 찍는다. 세 함수가 이 열한 개 명령을 글자 그대로 똑같이 갖고 있다.
 *
 *   plane  = x & 3          `and cl, 3` 다음 `mov ah,1 / shl ah,cl` 로 평면 마스크를
 *                           만들어 시퀀서 인덱스 2(포트 0x3C4)에 쓴다. 비트 하나만
 *                           서므로 언제나 평면 하나에만 들어간다.
 *   offset = y*80 + (x>>2)  `mul dx` 는 16비트 곱이고 상위 워드를 안 쓴다. 더하기도
 *                           16비트라, y 가 819 를 넘으면 오프셋이 접혀서 화면 위쪽에
 *                           쓴다. 원본이 그렇게 동작하는 것을 정답표로 확인했다
 *                           (y=900 이 오프셋 6464 로 접힌다).
 *
 * x 를 오른쪽으로 밀 때 원본은 `shr` 을 쓴다. 논리 이동이라 x 를 부호 없는 16비트로
 * 본다 — x=0xFFFF 는 열 16383 이지 -1 이 아니다. 이것도 정답표에 들어 있다.
 *
 * 색은 하위 한 바이트만 쓴다 (`mov bl, byte ptr [...]`). 여기서 따로 자르지 않는 것은
 * `Uint8Array` 에 넣는 것이 이미 256 으로 나눈 나머지를 취해서 `mov bl` 과 같은 답을
 * 주기 때문이다 — 자르는 코드를 넣어도 죽어 있다 (반증 시도로 확인했다: `& 0xff` 를
 * 지워도 정답표가 안 물었다).
 */
export function putByte(vram      , x        , y        , colour        )       {
  const cx = u16(x);
  const plane = cx & 3;
  const offset = u16(u16(u16(y) * BYTES_PER_ROW) + (cx >>> 2));
  vram[plane * PLANE_BYTES + offset] = colour;
}

/**
 * 열 x 에 y 부터 len 개의 픽셀을 세로로 찍는다 (0x05041).
 *
 * 원본은 끝값을 반복마다 다시 구하지만(`mov ax,si / add ax,[bp+0xa]`) si 가 인자 y 를
 * 받은 뒤 안 변하므로 값이 늘 같다. 여기서는 한 번만 구한다.
 *
 * 비교가 `jg` — **부호 있는** 비교다. 그래서 len 이 0 이거나 음수면 한 번도 안 돈다.
 * 둘 다 정답표에 있다.
 */
export function columnRun(vram      , x        , y        , len        , colour        )       {
  const end = i16(u16(u16(y) + u16(len)));
  for (let cur = u16(y); i16(cur) < end; cur = u16(cur + 1)) {
    putByte(vram, x, cur, colour);
  }
}

/**
 * 행 y 에 x0 부터 x0+len 까지 픽셀을 가로로 찍는다 (0x04FF1). **양 끝을 포함한다.**
 *
 * columnRun 의 가로 쌍둥이인데 반복이 끝나는 조건이 다르다. columnRun 은 `jg`(부호 있음,
 * 초과)라 y..y+len-1 의 len 개를 찍고, 이 함수는 `jge`(부호 있음, 이상)라 x0..x0+len 의
 * len+1 개를 찍는다. 그래서 len 이 0 이면 한 점(x0)을 찍고, 음수면 한 번도 안 돈다.
 *
 * 원본은 끝값(x0+len)을 반복마다 다시 구하지만 x0 도 len 도 안 변하므로 값이 늘 같다.
 * 여기서는 한 번만 구한다. 픽셀 하나를 찍는 부분은 putByte 와 명령까지 같다 (평면 마스크,
 * 오프셋 y*80+(x>>2), 시퀀서 포트 0x3C4).
 *
 * disasm 이름은 `vram-row-run-2` 다. `vram-row-run` 은 0x04F0B 에 잘못 붙었던 이름이라
 * (실제로는 rectOutline) 옮길 때 rectOutline 으로 고쳤고, 실제 가로줄인 이 함수가 `-2` 를
 * 물려받았다.
 */
export function rowRun(vram      , x0        , y        , len        , colour        )       {
  const end = i16(u16(u16(x0) + u16(len)));
  for (let cur = u16(x0); i16(cur) <= end; cur = u16(cur + 1)) {
    putByte(vram, cur, y, colour);
  }
}

/**
 * 상자 (x0,y0)-(x1,y1) 의 네 변을 그린다 (0x04F0B). 양 끝을 포함한다.
 *
 * 반복이 둘이고 서로 독립이다. 앞의 것이 x 를 x0 에서 x1 까지 늘리며 위아래 가로변을
 * 함께 찍고, 뒤의 것이 y 를 y0 에서 y1 까지 늘리며 좌우 세로변을 함께 찍는다.
 *
 * **두 반복이 따로 끝나므로 뒤집힌 상자는 절반만 그려진다.** 둘 다 `jle` 로 끝나는데,
 * x1 < x0 이면 앞의 반복이 아예 안 돌아 세로 두 줄만 남고, y1 < y0 이면 뒤의 반복이
 * 안 돌아 가로 두 줄만 남는다. 원저작자가 막아 두지 않았고, 정답표에 두 경우가 다 있다
 * (40,40,45,35 → 가로만 12개 / 50,50,45,55 → 세로만 12개).
 *
 * 이름을 고쳤다. 말뭉치에 `vram-row-run` 으로 적혀 있었는데 가로줄 하나가 아니라 네
 * 변이다 — 정답표에서 (0,0,3,3) 이 12바이트, (300,70,319,75) 가 48바이트로 나와서
 * 둘 다 둘레와 같다.
 */
export function rectOutline(
  vram      , x0        , y0        , x1        , y1        , colour        ,
)       {
  for (let x = u16(x0); i16(x) <= i16(x1); x = u16(x + 1)) {
    putByte(vram, x, y0, colour);
    putByte(vram, x, y1, colour);
  }
  for (let y = u16(y0); i16(y) <= i16(y1); y = u16(y + 1)) {
    putByte(vram, x0, y, colour);
    putByte(vram, x1, y, colour);
  }
}

/**
 * 글자 하나를 (x, y) 왼쪽 위 모서리에 그린다 (0x050EE).
 *
 * 글자를 펴는 부분은 BGI 쪽 글자 그리기(0x13737, port/lib/text.ts)와 명령 하나까지
 * 같다 — 같은 세 비교(0x61/0x30/0x2D)와 같은 상수(+0x9F/+0xEA/+0xF7), 같은 이중
 * 반복(줄 7 × 칸 5), 같은 글꼴 표 자리(DGROUP 0xAA, 글리프당 35바이트)다. 다른 것은
 * 픽셀을 어디에 찍느냐 하나뿐이라, 펴는 일은 `drawGlyph` 에 맡기고 여기서는 찍는 곳만
 * 준다.
 *
 * 원본은 `mov bl, byte ptr [bp+0xc]` 로 색의 하위 바이트만, `cmp byte ptr [bp+0xa]`
 * 로 글자의 하위 바이트만 읽는다. 둘 다 워드로 넘겨서 정답표로 확인했다. 여기서 따로
 * 자르지 않는 것은 `glyphIndex` 가 이미 하위 바이트만 부호 확장해서 보기 때문이다.
 */
export function drawChar(vram      , x        , y        , ch        , colour        )       {
  drawGlyph(x, y, ch, colour, (px, py, c) => putByte(vram, px, py, c));
}

// ─────────────────────────────────────────────────────────────────────────────
// 상자와 이름표 — 위의 세 원시 함수 위에 얹힌 것들
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이름표 상자 하나를 그린다 (0x04E5C).
 *
 * 테두리 둘과 안쪽 칠하기로 이루어진다. 안쪽 테두리는 색 1 이고 바깥 테두리와 안쪽
 * 칠하기는 색 0 이라, 밝은 선 하나가 검은 바탕을 두르는 모양이 된다. 크기가 인자에
 * 없다 — 폭 87 높이 17 이 코드에 박혀 있다.
 *
 * 세 반복이 겹치지 않아서 원본이 쓰는 바이트 수가 정확히 188 + 204 + 891 = 1283 이다.
 */
export function panelFill(vram      , x        , y        )       {
  rectOutline(vram, u16(x + 1), u16(y + 1), u16(x + 0x53), u16(y + 0xd), 1);
  rectOutline(vram, u16(x - 1), u16(y - 1), u16(x + 0x55), u16(y + 0xf), 0);
  for (let row = u16(y + 2); i16(u16(y + 0xc)) >= i16(row); row = u16(row + 1)) {
    for (let col = u16(x + 2); i16(u16(x + 0x52)) >= i16(col); col = u16(col + 1)) {
      putByte(vram, col, row, 0);
    }
  }
}

/**
 * 글자열 하나를 가로로 늘어놓는다 (0x051A8). 문자열 끝은 0 바이트다.
 *
 * 글자 하나가 가로 6칸을 차지하고 글꼴은 5칸 폭이라 사이에 빈 칸이 하나씩 들어간다.
 * BGI 쪽 글자열 그리기(0x136ED, port/lib/text.ts 의 `drawString`)와 달리 **그림자를
 * 안 그린다** — 저쪽은 검은색으로 한 번, 제 색으로 한 칸 옮겨 한 번, 두 번 그린다.
 */
export function drawString(
  vram      , x        , y        , s                   , colour        ,
)       {
  for (let i = 0; i < s.length && s[i] !== 0; i++) {
    drawChar(vram, u16(x + u16(i * 6)), y, s[i], colour);
  }
}

/**
 * Borland 의 `ltoa(값, 버퍼, 10)` 재구현.
 *
 * 원본은 이미지 0x03227 인데 **말뭉치에 줄이 없다** — 게임 본체(0x040B4 아래)가 아닌
 * 라이브러리 코드이고 아직 디스어셈블하지 않았다. 그래서 여기 `// @원본` 에 안 적는다.
 * 대신 정답표 `ltoa` 항목이 값 일곱 개로 판정한다. 0 · 3 · 42 · -1234 · 1234567 ·
 * -2147483648 · 2147483647 을 넣어 받은 답이 전부 부호 있는 십진수였다. 뒤집을 수 없는
 * 값(-2147483648)도 `"-2147483648"` 로 제대로 나온다.
 */
export function ltoaDecimal(lo        , hi        )             {
  const value = ((u16(hi) << 16) | u16(lo)) | 0;
  const text = value.toString(10);
  const buf = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i++) buf[i] = text.charCodeAt(i);
  return buf;
}

/**
 * 32비트 부호 있는 값을 오른쪽 끝이 x 에 맞도록 쓴다 (0x051E0).
 *
 * 먼저 쓸 자리를 색 0 으로 지우고 그 위에 글자를 얹는다. 지우는 폭이 (자릿수 + 1) × 6
 * 이고 높이는 y-1 부터 y+7 까지 아홉 줄이다.
 *
 * **값이 딱 3 일 때만 한 칸을 더 지운다.** `hi == 0 && lo == 3` 인 갈래가 따로 있어서
 * 지우는 폭이 6 만큼 늘어난다. 원저작자가 무엇을 고치려던 것인지는 코드에 없다.
 * 정답표로 확인했다 — 값 0 은 108바이트를 쓰고 값 3 은 162바이트를 쓴다.
 *
 * ## 원저작자의 흠 — 글자 버퍼가 자기 변수를 덮는다
 *
 * 지역 변수가 14바이트인데(`sub sp, 0xE`) 그 안에 넷이 함께 산다.
 *
 * ```
 *   [bp-0xE] 글자 버퍼 9바이트   [bp-5] 자릿수   [bp-4] 줄   [bp-2] 칸
 *    버퍼[0..8]                  버퍼[9]        버퍼[10..11]  버퍼[12..13]
 * ```
 *
 * 그래서 열 자리가 넘는 수는 `ltoa` 가 버퍼 밖으로 넘쳐 쓰고, 뒤이어 자릿수와 반복
 * 변수가 그 자리를 다시 덮는다. 결과가 **글자가 사라지는 것**이다 — 덮인 자리에 들어간
 * 값(자릿수, 줄 번호)이 글꼴 표의 세 범위 어디에도 안 걸려서 아무것도 안 그려진다.
 * 자리는 그대로 비워 둔 채 글자만 없다.
 *
 * 실측이다. `-2147483648` 을 넣으면 원본이 글자 자리 열하나 중 **앞의 아홉만** 칠한다.
 * 처음에는 이것을 모르고 열하나를 다 그렸다가 정답표에 27건이 걸렸다.
 *
 * 그래서 여기서는 지역 변수 14바이트를 실제로 만들고 그 위에서 돈다. 겹치는 자리를
 * 흉내내지 않으면 이 함수는 큰 수에서 원본과 갈라진다.
 *
 * 자릿수는 `strlen` 의 답을 바이트 한 칸에 넣었다가 부호 확장해서 다시 읽는다
 * (`mov byte ptr [bp-5], al` 다음 `mov al, [bp-5] / cbw`). **이 부호 확장은 정답표가
 * 구별하지 못한다** — 반증 시도에서 `sbyte` 를 빼도 한 건도 안 걸렸다. 32비트 수의
 * 자릿수가 128 에 닿을 수 없어서 부호가 붙는 경우가 아예 없기 때문이다. 그래도 남기는
 * 것은 원본이 실제로 그 명령을 갖고 있어서다. 검증된 줄이 아니라 옮겨 적은 줄이다.
 */
export function drawNumber(
  vram      , x        , y        , lo        , hi        , colour        ,
)       {
  const frame = new Uint8Array(14);
  const fv = new DataView(frame.buffer);
  const BUF = 0, LEN = 9, ROW = 10, COL = 12;

  const text = ltoaDecimal(lo, hi);
  frame.set(text.subarray(0, frame.length), BUF);

  let n = 0;
  while (BUF + n < frame.length && frame[BUF + n] !== 0) n++;
  frame[LEN] = n & 0xff;

  fv.setUint16(ROW, u16(y - 1), true);
  for (;;) {
    const row = fv.getUint16(ROW, true);
    if (i16(u16(y + 8)) <= i16(row)) break;
    const extra = u16(hi) === 0 && u16(lo) === 3 ? 1 : 0;
    fv.setUint16(COL, u16(x - u16(u16(sbyte(frame[LEN]) + extra + 1) * 6)), true);
    for (;;) {
      const col = fv.getUint16(COL, true);
      if (i16(col) >= i16(x)) break;
      putByte(vram, col, row, 0);
      fv.setUint16(COL, u16(col + 1), true);
    }
    fv.setUint16(ROW, u16(row + 1), true);
  }

  for (let i = 0; BUF + i < frame.length && frame[BUF + i] !== 0; i++) {
    drawChar(vram, u16(x + u16(u16(i - sbyte(frame[LEN])) * 6)), y, frame[BUF + i], colour);
  }
}

/**
 * 상자 + 이름 + 숫자를 한 번에 그린다 (0x05091). 게임의 메뉴·상점 화면이 쓰는 단위다.
 *
 * 두 부분이 각각 조건부다. 깃발(하위 바이트)이 0 이 아니면 상자와 이름을 건너뛰고
 * 숫자만 다시 그린다 — 값만 바뀌었을 때 상자를 다시 안 그리려는 것이다. 값이 0 이면
 * (`lo | hi` 가 0) 숫자를 아예 안 그린다.
 *
 * 숫자의 색은 인자로 안 받고 2 로 박혀 있다.
 */
export function labelledPanel(
  vram      , x        , y        , s                   ,
  lo        , hi        , flag        , colour        ,
)       {
  if ((flag & 0xff) === 0) {
    panelFill(vram, x, y);
    drawString(vram, u16(x + 4), u16(y + 4), s, colour);
  }
  if ((u16(lo) | u16(hi)) !== 0) {
    drawNumber(vram, u16(x + 0x51), u16(y + 4), lo, hi, 2);
  }
}

/**
 * DGROUP 의 글자열 상수를 실행 파일에서 그대로 읽는다.
 *
 * 글꼴 표와 같은 이유다 (port/lib/text.ts) — 원본의 바이트를 옮겨 적는 단계를 없애면
 * 어긋날 자리도 없어진다. 자리는 DGROUP 이미지 오프셋 0x1AA60 + 오프셋 + 파일 헤더 0x1600.
 */
function dgroupString(offset        )             {
  const dgroup = readFileSync(fileURLToPath(new URL("../data/DGROUP.BIN", import.meta.url)));
  const at = offset;
  const end = dgroup.indexOf(0, at);
  return new Uint8Array(dgroup.subarray(at, end + 1));
}

/** 이름 입력이 상자에 붙이는 이름표. DGROUP 0x21C3 이고 빈 글자열이다. */
export const PROMPT_LABEL             = dgroupString(0x21c3);

/** 이름을 안 치고 엔터를 누르면 나오는 기본값. DGROUP 0x21C4 = "unknown". */
export const PROMPT_DEFAULT             = dgroupString(0x21c4);

/** 이름 입력이 받아 주는 글자인가 (0x053B3..0x053F5). 비교가 전부 부호 있는 바이트다. */
function accepted(ch        )          {
  const c = sbyte(ch);
  if (c >= 0x41 && c <= 0x5a) return true;
  if (c >= 0x61 && c <= 0x7a) return true;
  if (c >= 0x30 && c <= 0x39) return true;
  return c === 0x2e || c === 0x2d || c === 0x20 || c === 0x0d || c === 0x1b;
}

/**
 * 이름을 한 줄 입력받는다 (0x052BE). 게임의 탱크 이름 입력 자리다.
 *
 * 원본은 `getch`(0x0203B, INT 21h AH=07)로 키를 하나씩 받는다. 하드웨어에 매인 부분이
 * 그것 하나뿐이라, 포트는 **getch 가 돌려줄 바이트의 목록**을 인자로 받는다. 정답표의
 * 그 목록은 내가 짝지은 것이 아니라 원본의 getch 를 직접 불러 잰 것이다 — 예를 들어
 * capslock 을 누른 뒤의 `q` 는 0x51(대문자 `Q`)로 들어온다.
 *
 * 원본이 맨 앞에서 도는 `while (kbhit()) getch()` 는 여기 없다. 그것은 부르기 전에 이미
 * 눌려 있던 키를 버리는 것이라, 목록이 그 뒤의 키만 담는다는 것과 같은 뜻이다.
 *
 * 버퍼는 미리 "unknown" 으로 채워져 있다. 그래서 아무것도 안 치고 엔터를 누르면 그것이
 * 그대로 나온다.
 *
 * 세 가지가 눈에 띈다.
 *   · 지우기(0x08)는 받아 주는 글자 목록에 없다. 지우는 일을 먼저 하고, 그 다음 목록
 *     검사에서 걸러져 그리기 없이 처음으로 돌아간다.
 *   · 대문자는 커서를 지운 **뒤에** 소문자로 바뀐다.
 *   · 글자 수가 13 이 되면 **다음 글자가 무엇이든** 그것을 안 넣고 끝낸다. 길이 검사가
 *     엔터 검사보다 먼저 있어서 그렇다.
 */
export function textInputPrompt(
  vram      , x        , y        , keys                   , colour        ,
)                                      {
  labelledPanel(vram, u16(x - 4), u16(y - 4), PROMPT_LABEL, 0, 0, 0, 0);

  const buf = new Uint8Array(20);
  buf.set(PROMPT_DEFAULT);
  let count = 0;                      // [bp-2] — 부호 있는 바이트다
  let k = 0;

  for (;;) {
    columnRun(vram, u16(x + u16(sbyte(count) * 6)), u16(y - 1), 9, 3);
    if (k >= keys.length) {
      throw new RangeError(`textInputPrompt: 키가 ${keys.length}개뿐인데 더 받으려 한다`);
    }
    const ch = keys[k++] & 0xff;

    if (ch === 8 && count !== 0) {
      count = sbyte(count - 1);
      const base = u16(x + u16(sbyte(count) * 6));
      for (let row = u16(y - 1); i16(u16(y + 8)) > i16(row); row = u16(row + 1)) {
        for (let col = base; i16(u16(base + 7)) > i16(col); col = u16(col + 1)) {
          putByte(vram, col, row, 0);
        }
      }
    }
    if (!accepted(ch)) continue;

    columnRun(vram, u16(x + u16(sbyte(count) * 6)), u16(y - 1), 9, 0);
    // 여기서부터 원본은 바꾼 값을 같은 자리([bp-1])에 다시 넣고 그것만 본다.
    const c = ch >= 0x41 && ch <= 0x5a ? (ch + 0x20) & 0xff : ch;

    // 취소로 나가는 길에서는 원본이 부르는 쪽 버퍼에 아무것도 안 쓴다 — strcpy 를 안 한다.
    if ((c === 0x20 && count === 0) || c === 0x1b) return { result: 0, out: new Uint8Array(0) };
    if (count === 0x0d || c === 0x0d) return { result: 1, out: buf.subarray(0, buf.indexOf(0)) };

    drawChar(vram, u16(x + u16(sbyte(count) * 6)), y, c, colour);
    buf[count] = c;
    buf[count + 1] = 0;
    count = sbyte(count + 1);
  }
}
