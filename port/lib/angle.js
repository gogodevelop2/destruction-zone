// 원본 DZONE.EXE 의 각도 함수(이미지 0x138AF)와 정수 제곱근(0x139E0) 재구현.
//
// 원본: disasm/addr_0x138AF.md, disasm/addr_0x139E0.md.
// 뜻과 근거는 analysis/angle_and_helpers.md.
// 맞는지는 goldens/angle_vectors_v1/vectors.json 이 판정한다
// (port/test/angle.test.ts).
//
// 이 두 함수는 게임 코드에서 유일하게 부동소수점을 쓰는 자리다. 원본 실행 파일
// 안에서는 8087 명령이 Borland 에뮬레이터 트랩(INT 0x34~0x3D)으로 저장돼 있지만,
// 시동 코드가 8087 을 찾으면 그 자리를 진짜 명령으로 덮어쓴다. 우리가 재는
// 기계에서는 덮어쓴 쪽, 즉 하드웨어 부동소수점이 돈다.
// @원본 0x138AF 0x139E0

const i16 = (v        )         => (v << 16) >> 16;

/** 원본이 미는 갈래 표시. asin 은 0, acos 은 0xFF (disasm/addr_0x01010.md). */
const WANT_ASIN = 0x00;
const WANT_ACOS = 0xff;

/**
 * 원본의 asin·acos 일꾼(이미지 `0x00F11`)을 그대로 옮긴 것.
 *
 * ⚠ `Math.asin` 을 부르지 않는다. 원본은 표를 쓰지도, 라이브러리 asin 을 부르지도
 * 않고 8087 의 `fsqrt` 와 `fpatan` 으로 직접 만든다. 계산의 모양이 다르면 마지막
 * 자리가 갈릴 수 있으므로 원본이 하는 순서를 그대로 따른다.
 *
 * pi 는 원본이 8087 의 `fldpi` 로 얻는다. 그쪽은 80비트이고 여기서는 64비트라
 * 그만큼은 어쩔 수 없이 다르다 (약 1e-19).
 */
export function arcSineOrCosine(x        , want        )         {
  const neg = x < 0 || Object.is(x, -0);   // 원본은 double 의 부호 비트를 본다
  const ax = Math.abs(x);
  let flip = want;                          // 원본의 dl
  let negative = neg;                       // 원본의 dh 최상위 비트
  let a        ;

  if (ax === 0) {
    // 0x00F9B. 부호를 지우고(dh = 0) 곧바로 마무리로 간다.
    negative = false;
    a = want === WANT_ACOS ? Math.PI / 2 : 0;
  } else if (ax > 1) {
    // 0x00FE2. 정의역 밖 — 원본은 DGROUP 0x2E52 의 NaN 을 준다.
    return NaN;
  } else if (ax === 1) {
    // 0x00FAB. 갈래에 따라 0 또는 pi/2 를 놓고 마무리로 간다.
    a = want === WANT_ACOS ? 0 : Math.PI / 2;
  } else {
    const s = Math.sqrt(1 - ax * ax);
    if (s > ax) {
      a = Math.atan2(ax, s);                // fpatan: asin|x|
    } else if (s === ax) {
      // 0x00FC8. |x| 가 1/sqrt(2) 라 두 갈래의 답이 똑같이 pi/4 다.
      // 원본은 여기서 갈래 검사를 건너뛴다.
      a = Math.PI / 4;
      return finishArcSign(a, negative, want);
    } else {
      a = Math.atan2(s, ax);                // fpatan: acos|x|
      flip = flip === 0 ? WANT_ACOS : 0;    // 원본의 `not dl`
    }
    if (flip !== 0) a = Math.PI / 2 - a;
  }
  return finishArcSign(a, negative, want);
}

/** 원본 0x00F78 부터의 마무리 — 인자가 음수였을 때의 보정. */
function finishArcSign(a        , negative         , want        )         {
  if (!negative) return a;
  a = -a;
  if (want === WANT_ACOS) a = a + Math.PI;   // acos(-t) = pi - acos(t)
  return a;
}

/** 원본 `0x01027`. 갈래 표시 0 으로 일꾼을 부른다. */
export function arcSine(x        )         {
  return arcSineOrCosine(x, WANT_ASIN);
}

/** 원본 `0x01010`. 게임은 부르지 않지만 갈래 표시의 짝이라 함께 둔다. */
export function arcCosine(x        )         {
  return arcSineOrCosine(x, WANT_ACOS);
}

/**
 * 원본이 라디안을 도로 바꿀 때 나누는 값. DGROUP 0x25BD 의 8바이트가
 * 3.1415926 이고 진짜 원주율이 아니다 — C 원본에 소수 일곱 자리로 적어 넣은
 * 값이다. 상대 차이가 1.7e-8 이라 정수 도 결과를 혼자서 바꾸지는 못하지만,
 * 원본이 나누는 값은 이것이다.
 */
export const PI_CONSTANT = 3.1415926;

/**
 * 첫 점에서 둘째 점으로 가는 방향의 각을 도 단위 정수로 준다. 결과는 0..359 이고
 * 반시계 방향이며, x 가 커지는 쪽이 0 도다.
 *
 * 두 점이 같으면 0 을 준다 — 원본이 그 경우만 따로 걸러 낸다.
 *
 * ⚠ 좌표의 차이를 16비트로 자른다. 원본이 `sub ax, ...` 한 결과를 그대로
 * `fild word` 로 읽기 때문에, 차이가 32767 을 넘으면 부호가 뒤집힌다.
 */
export function angle(x1        , y1        , x2        , y2        )         {
  const dx = i16(x2 - x1);
  const dy = i16(y2 - y1);
  if (dx === 0 && dy === 0) return 0;

  const dist = Math.sqrt(dx * dx + dy * dy);
  let a = (arcSine(dy / dist) * 180.0) / PI_CONSTANT;

  if (dx < 0) {
    a = 180.0 - a;
    if (dy < 0) {
      // 원본에는 360 에서 빼는 단계가 여기 연달아 둘 있다. 둘 다 같은 dy 를
      // 같은 방향으로 검사하므로 언제나 함께 돌고 서로를 되돌린다. 지우지 않고
      // 그대로 두는 이유는 double 반올림까지 원본과 같게 두기 위해서다.
      a = 360.0 - a;
      a = 360.0 - a;
    }
  }

  return Math.trunc(a + 360.0) % 360;
}

/**
 * 원본이 종료하는 입력의 위쪽 끝. 이 위에서는 원본이 되돌아오지 않는다 —
 * 아래 `integerSquareRoot` 의 설명 참조.
 */
export const ISQRT_MAX = 32761;

/**
 * 올림한 정수 제곱근. 크기에 따라 고른 시작값에서 1씩 올리며 제곱이 인자 이상이
 * 되는 첫 값을 준다.
 *
 * 인자가 0 이하이면 1 을 준다. 시작값이 1 이고 첫 비교부터 통과하기 때문이지
 * 따로 걸러 내는 것이 아니다.
 *
 * ⚠ 원본은 제곱을 16비트로 자른 채 비교한다. 그래서 인자가 32761 을 넘으면
 * 제곱이 부호를 넘겨 비교가 영원히 참이 되고 되돌아오지 않는다. 여기서는 조용히
 * 다른 값을 내는 대신 크게 실패한다.
 */
export function integerSquareRoot(n        )         {
  const cx = i16(n);
  if (cx > ISQRT_MAX) {
    throw new RangeError(
      `integerSquareRoot: ${cx} 는 원본이 되돌아오지 않는 값이다. ` +
      `원본은 제곱을 16비트로 자른 채 비교하므로 ${ISQRT_MAX} 를 넘으면 ` +
      `비교가 영원히 참이 되어 멈추지 않는다.`,
    );
  }
  let bx = 1;
  if (cx > 900) bx = 30;
  if (cx > 2500) bx = 50;
  if (cx > 10000) bx = 100;
  for (;;) {
    if (!(i16((bx * bx) & 0xffff) < cx)) return bx;
    bx = i16(bx + 1);
  }
}
