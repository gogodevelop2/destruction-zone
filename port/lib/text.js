// 원본 DZONE.EXE 의 글자 그리기와 두 자리 숫자 만들기 재구현.
//
//   0x136ED  drawString       문자열 하나를 화면에 그린다
//   0x13737  drawGlyph        글자 하나를 5x7 격자로 펼친다
//   0x13C0D  formatTwoDigit   0..99 를 오른쪽 맞춤 두 글자로 쓴다
//   0x13A15  stringAppend     문자열 하나를 다른 문자열 뒤에 붙인다 (strcat)
//
// 뜻은 analysis/text_rendering.md 에, 바이트 근거는 disasm/addr_0x136ED.md,
// disasm/addr_0x13737.md, disasm/addr_0x13C0D.md, disasm/addr_0x13A15.md,
// disasm/data_0x00AA.md 에 있다. 0x13A15 의 계산 배경은 analysis/angle_and_helpers.md 에도 있다.
//
// 그리기 중에 텍스트만은 .GDA 드라이버 안에 있지 않다. 게임 본체가 글꼴 표를 갖고
// 있고 글자 모양을 자기가 펼치며, 드라이버에는 픽셀 하나 찍는 것만 맡긴다.
// @원본 0x136ED 0x13737 0x13C0D 0x13A15

import { readFileSync } from "../../web/shim.js";
import { fileURLToPath } from "../../web/shim.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const GLYPH_COUNT = 38;

// 글꼴 표는 계산으로 만들지 않는다. 사인 표와 같은 이유로 원본의 글자꼴은 원본의
// 바이트다. 실행 파일에서 직접 읽어 옮겨 적는 단계를 없앤다.
//   DGROUP 이미지 오프셋 0x1AA60 + 표 오프셋 0xAA + 파일 헤더 0x1600
function loadGlyphTable()             {
  const dgroup = readFileSync(fileURLToPath(new URL("../data/DGROUP.BIN", import.meta.url)));
  const at = 0xaa;
  const table = new Uint8Array(dgroup.subarray(at, at + GLYPH_COUNT * GLYPH_W * GLYPH_H));
  if (table.length !== GLYPH_COUNT * GLYPH_W * GLYPH_H || table.some((b) => b > 1)) {
    throw new Error("DGROUP.BIN 의 글꼴 표 자리에 0/1 이 아닌 바이트가 있다");
  }
  return table;
}

export const GLYPH_TABLE             = loadGlyphTable();

/** 픽셀 하나를 찍는다. 원본은 BGI 의 putpixel(0x140B:0x2078)을 부른다. */
                                                                      

/**
 * 글자 하나를 표의 번호로 바꾼다 (0x1373F..0x1376F).
 *
 * 세 비교가 `jl` 로 이어져 있어 먼저 걸리는 것을 쓴다. 비교가 바이트 단위이고
 * 부호가 있으므로 0x80 이상은 음수가 되어 셋 다 안 걸린다. 공백(0x20)도 안 걸리는데
 * 부르는 쪽이 이미 자리를 옮겨 놓았으므로 결과적으로 빈 칸 하나가 된다.
 *
 * 안 걸리면 null 을 낸다 — 원본은 아무것도 안 그리고 나간다.
 */
export function glyphIndex(ch        )                {
  const c = sbyte(ch);
  if (c >= 0x61) return sbyte(c + 0x9f);
  if (c >= 0x30) return sbyte(c + 0xea);
  if (c >= 0x2d) return sbyte(c + 0xf7);
  return null;
}

/** 글자 하나를 (x, y) 왼쪽 위 모서리에 그린다 (0x13737). */
export function drawGlyph(x        , y        , ch        , colour        , put          )       {
  const idx = glyphIndex(ch);
  if (idx === null) return;
  if (idx >= GLYPH_COUNT) {
    // 표는 38개에서 끝나고 그 뒤는 상점 품목 카탈로그다. 원본은 그 텍스트 바이트를
    // 글자꼴로 읽는다. 게임이 실제로 넘기는 글자에는 없는 경우라 여기서 크게 실패한다.
    throw new RangeError(
      `drawGlyph: 글자 0x${(ch & 0xff).toString(16)} 이 표 밖의 번호 ${idx} 를 만든다. ` +
      `원본은 여기서 글꼴 표 뒤의 DGROUP(상점 품목 카탈로그)을 읽는다.`,
    );
  }
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (GLYPH_TABLE[idx * (GLYPH_W * GLYPH_H) + row * GLYPH_W + col] !== 0) {
        put(i16(x + col), i16(y + row), sbyte(colour));
      }
    }
  }
}

/**
 * 문자열 하나를 그린다 (0x136ED). 문자열 끝은 0 바이트다.
 *
 * 글자 하나가 가로 6칸을 차지하고 글꼴은 5칸 폭이라 사이에 빈 칸이 하나씩 들어간다.
 * 안쪽 반복이 두 번 도는 것이 그림자다 — j=0 일 때는 색이 `colour * 0 = 0` 이라
 * 검게 찍고, j=1 일 때 제 색으로 오른쪽 아래로 한 칸 옮겨 덧그린다.
 *
 * 색은 하위 한 바이트만 읽어 부호 확장한다 (`mov al, [bp+0xc]` 다음 `cbw`).
 */
export function drawString(x        , y        , s                   , colour        , put          )       {
  for (let i = 0; i < s.length && s[i] !== 0; i++) {
    for (let j = 0; j < 2; j++) {
      drawGlyph(i16(x + i16(i * 6) + j), i16(y + j), s[i], i16(sbyte(colour) * j), put);
    }
  }
}

/**
 * 0..99 를 오른쪽 맞춤 두 글자와 끝의 0 바이트로 쓴다 (0x13C0D). 버퍼는 3바이트다.
 *
 * 10 미만이면 공백과 숫자 하나를 쓴다. 10 이상이면 십의 자리와 일의 자리를 쓰는데,
 * 몫을 두 번 나눠서 다시 구한다. 음수와 세 자리는 처리하는 갈래가 아예 없어서 잘리는
 * 것이 아니라 틀린 값이 나온다 — 원본을 그대로 옮겼으므로 여기서도 그렇게 나온다.
 */
export function formatTwoDigit(buf            , off        , n        )       {
  const cx = i16(n);
  if (cx < 0xa) {
    buf[off] = 0x20;
    buf[off + 1] = (cx + 0x30) & 0xff;          // add al, 0x30 — 하위 바이트끼리
  } else {
    const q = i16(Math.trunc(cx / 10));          // cwd 다음 idiv bx
    buf[off] = (q + 0x30) & 0xff;
    const tens = i16(i16(Math.trunc(cx / 10)) * 10);  // 몫을 다시 구해 10 을 곱한다
    buf[off + 1] = (((cx & 0xff) - (tens & 0xff)) + 0x30) & 0xff;  // 전부 바이트 연산
  }
  buf[off + 2] = 0;
}

/**
 * 라이브러리 strlen(0x03994)을 그 자리에 펼친 것. 0x13A15 만 쓴다. status.tsv 에서
 * 0x03994 는 제외-라이브러리로 남는다 — 따로 옮긴 함수가 아니라 여기 인라인이다.
 *
 * 원본: `xor ax,ax; cld; mov cx,0xFFFF; repne scasb` 다음 `xchg cx,ax; not ax; dec ax`.
 * 0 바이트를 만나면 그때까지 훑은 칸 수(= 길이)를 낸다. 65535칸 안에 0 이 없으면
 * cx 가 0 까지 내려가고 0xFFFE 가 나온다. 상한을 따로 씌우지 않는다.
 */
function strlenNear(seg            , ptr        )         {
  let di = u16(ptr);
  let cx = 0xffff;
  while (cx !== 0) {
    const b = seg[di];
    di = u16(di + 1);
    cx = u16(cx - 1);
    if (b === 0) break;
  }
  return u16(u16(~cx) - 1); // xchg cx,ax; not ax; dec ax
}

/**
 * 문자열 이어 붙이기 (0x13A15). C 의 strcat 과 같다. dst 뒤에 src 를 붙이고 0 으로
 * 끝맺는다. 사이 화면 0x090E9 가 여섯 번 불러 화면 한 줄을 조각(" ", "-",
 * "d-zone statistics board" 따위)으로 만든다.
 *
 * seg 는 근처 데이터 세그먼트를 통째로 담은 64KiB 배열이고, dst 와 src 는 그 안의
 * 절대 오프셋이다. 원본은 near 포인터로 DGROUP 안을 가리키고 자리 계산을 전부 16비트
 * 덧셈(`add bx,si; add bx,[bp-2]`)으로 하므로, 포트도 세그먼트를 통째로 두고 오프셋을
 * 16비트로 접는다. 버퍼를 짧게 잘라 두면 원본이 경계를 안 보는 자리에서 갈라진다
 * (작업 11 과 같은 이유 — 원본은 경계를 안 본다).
 *
 * 원본이 바깥에 남기는 것은 하나가 아니다. src 의 바이트를 dst 끝에 복사하는 것과,
 * 그와 따로 계산한 자리에 0 을 쓰는 것 두 가지다. 복사 반복의 종료 조건은 부호 있는
 * 비교(`cmp si,[bp-4]; jl`)이고, 0 을 쓰는 자리는 부호 없는 16비트 덧셈이다. 그래서
 * src 길이가 0x8000 이상이면 복사는 한 칸도 안 하는데 0 은 dst 앞쪽에 찍힌다. 이
 * 갈림을 그대로 옮긴다 (정답표는 짧은 문자열만 담아 이 경로는 안 밟는다 — 아래 golden
 * README 참조).
 *
 * 값을 안 돌려주는 것으로 옮겼다. 원본은 `retf` 시점에 ax 에 무언가를 남기지만 — 복사
 * 반복이 al 만 매 회 덮으므로 마지막으로 복사한 바이트가, 반복이 한 번도 안 돌면 src 의
 * 길이가 들어 있다 — 부르는 여섯 곳이 전부 곧바로 ax 를 덮는다 (0x0A32A 등에서
 * `pop cx; pop cx; mov ax,0xa`, 0x0A44C 에서 `inc di; mov al,[0x4D73]`). C 의 strcat 처럼
 * dst 를 돌려주지도 않는다. 쓰는 곳이 없으므로 안 옮겼다.
 *
 * @원본 0x13A15
 */
export function stringAppend(seg            , dst        , src        )       {
  if (seg.length !== 0x10000) {
    throw new RangeError("stringAppend: seg 는 64KiB(0x10000) 배열이어야 한다");
  }
  const dstLen = strlenNear(seg, dst); // [bp-2]
  const srcLen = strlenNear(seg, src); // [bp-4]
  for (let si = 0; i16(si) < i16(srcLen); si = u16(si + 1)) {
    seg[u16(dst + si + dstLen)] = seg[u16(src + si)];
  }
  seg[u16(dst + dstLen + srcLen)] = 0;
}
