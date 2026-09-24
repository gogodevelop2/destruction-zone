// Borland C 의 32비트 산술 도우미 재구현.
//
// 원본 위치와 증거는 disasm/addr_0x011D3.md(나눗셈), disasm/addr_0x0117A.md(곱셈),
// disasm/addr_0x01281.md(왼쪽 시프트)에 있고, 뜻은 analysis/borland_helpers.md 에 있다.
// 이 파일이 맞는지는 원본에서 받아 적은 goldens/lib_vectors_v1/vectors.json 이 판정한다
// (port/test/borland_long.test.ts).
//
// 값은 전부 부호 없는 32비트로 주고받는다. 자바스크립트의 비트 연산은 32비트 부호 있는
// 정수를 내므로 밖으로 나갈 때마다 >>> 0 으로 되돌린다.
// @원본 0x0117A 0x011D3 0x01281

export const u32 = (v        )         => v >>> 0;
export const i32 = (v        )         => v | 0;

// 제수가 0 이면 크게 실패한다. 원본 0x011D3 계열은 짧은 경로에서 하드웨어 나눗셈을
// 쓰고(0x01274 `div bx`), 8086 은 0 으로 나누면 나눗셈 예외(INT 0)를 낸다. Borland
// 런타임이 그것을 받아 프로그램을 끝내므로 "그때 나오는 값" 이라는 것이 없다 — 정답표를
// 만들 수 없는 자리다. 자바스크립트에서 `x / 0` 은 Infinity 이고 `>>> 0` 이 그것을 0 으로
// 접어, 고치기 전에는 sdiv(a,0) 이 조용히 0 을 냈다 (2026-09-06, esc_award hold-out 이
// 잡았다 — 원본이 죽는 자리에서 포트가 그럴듯한 0 을 내고 지나갔다).
function assertDivisor(b        )       {
  if (u32(b) === 0)
    throw new Error("borland_long: 0 으로 나눔 — 원본은 INT 0 로 죽는다 (대조할 값이 없다)");
}

/** 부호 있는 나눗셈의 몫. 0 쪽으로 자른다 (원본 진입점 0x011D6). */
export function sdiv(a        , b        )         {
  assertDivisor(b);
  const q = i32(a) / i32(b);
  return u32(Math.trunc(q));
}

/** 부호 없는 나눗셈의 몫 (원본 진입점 0x011DD). */
export function udiv(a        , b        )         {
  assertDivisor(b);
  return u32(Math.floor(u32(a) / u32(b)));
}

/** 부호 있는 나머지. 부호는 피제수를 따른다 (원본 진입점 0x011E5). */
export function smod(a        , b        )         {
  assertDivisor(b);
  return u32(i32(a) % i32(b));
}

/** 부호 없는 나머지 (원본 진입점 0x011ED). */
export function umod(a        , b        )         {
  assertDivisor(b);
  return u32(u32(a) % u32(b));
}

/** 32비트 곱셈. 넘치는 자리는 버린다 (원본 0x0117A / 근거리 쌍둥이 0x01443). */
export function lmul(a        , b        )         {
  const al = a & 0xffff, ah = a >>> 16;
  const bl = b & 0xffff, bh = b >>> 16;
  const lo = al * bl;
  const mid = (al * bh + ah * bl) & 0xffff;
  return u32(((lo >>> 16) + mid) * 0x10000 + (lo & 0xffff));
}

/**
 * 왼쪽 시프트 (원본 0x01284). 원본이 16을 경계로 갈라 16비트 연산으로 하므로
 * 그 갈래를 그대로 옮긴다 — 자릿수가 32 이상일 때의 동작이 곧바로 `<<` 와 같지 않다.
 */
export function lshl(a        , n        )         {
  let ax = a & 0xffff;
  let dx = (a >>> 16) & 0xffff;
  const cl = n & 0xff;
  if (cl < 0x10) {
    const bx = ax;
    const c = cl & 0x1f;                       // x86 는 자릿수를 5비트로 자른다
    ax = (ax << c) & 0xffff;
    dx = (dx << c) & 0xffff;
    const back = (0x10 - cl) & 0x1f;
    dx = (dx | (back >= 16 ? 0 : bx >>> back)) & 0xffff;
  } else {
    const c = (cl - 0x10) & 0x1f;
    dx = (ax << c) & 0xffff;
    ax = 0;
  }
  return u32(dx * 0x10000 + ax);
}
