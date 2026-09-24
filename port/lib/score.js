// 점수를 평균 대비 퍼센트로 내는 0x05F07 을 옮긴 것이다.
//
// 호출 그래프의 말단이다 — 32비트 곱셈·나눗셈 도우미 말고는 아무것도 안 부른다.
// 부르는 곳은 상점 화면 `0x05FB3`(4곳)과 상점의 탱크 칸 `0x05D44`(2곳)이다.
// @원본 0x05F07
import { sdiv, lmul, i32 } from "./borland_long.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

const SCORE_LO = 0x4424;      // 탱크 레코드 +0x28 (DGROUP 절대). 0x05F2D/0x05F97 의 [bx+0x4424]
const TANK_STRIDE = 0x176;
const PLAYER_COUNT = 0x4d73;  // 바이트, cbw 로 부호 있게 읽는다 (0x05F38/0x05F40)

function readI32(dg            , at        )         {
  return i32(dg[u16(at)] | (dg[u16(at + 1)] << 8) | (dg[u16(at + 2)] << 16) | (dg[u16(at + 3)] << 24));
}

/**
 * 0x05F07 의 마지막 산술. `total` 은 전 탱크 점수의 32비트 합, `mine` 은 이 탱크의 점수.
 * 원본 0x05F4D(평균)·0x05F7C(곱)·0x05F83(나눗셈)·0x05F9F(점수 0 검사).
 *
 * ⚠ 평균이 0 인데 이 탱크 점수가 0 이 아니면 원본은 `[bp-8]`(몫)을 한 번도 안 채운 채
 *   돌아간다 — 스택에 남아 있던 값을 낸다. 점수 합이 탱크 수보다 작기만 해도 그 조건이
 *   성립한다(예: 합 3, 탱크 6 → 평균 0). 포트는 그 쓰레기 값을 알 수 없으므로 크게 실패한다.
 */
function scorePercentCore(total        , tankCount        , mine        )         {
  const average = sdiv(total, tankCount);                               // 0x05F4D
  if (mine === 0) return 100;                                           // 0x05F9F → 0x05FA1
  if (average === 0)
    throw new Error(
      `0x05F07: 평균이 0 인데 점수가 ${mine} 이다. 원본은 여기서 채워지지 않은 스택 값을 낸다`);
  return sdiv(lmul(100, mine), average) & 0xffff;                       // 0x05F7C·0x05F83, ax 만
}

/**
 * 원본 0x05F07. `scores[i]` 를 미리 뽑아 배열로 받는 진입점 (goldens/score_vectors_v1 이
 * 이 모양이다). 색인은 0..tankCount-1 안이라고 본다.
 *
 * @param scores    tank[i].+0x28 여섯 개 (32비트 부호 있음)
 * @param tankCount DGROUP 0x4D73
 * @param index     보고 싶은 탱크
 */
export function scorePercentOfAverage(
  scores                   , tankCount        , index        ,
)         {
  let total = 0;
  for (let i = 0; i < tankCount; i++) total = i32(total + scores[i]);   // 0x05F31 add/adc
  return scorePercentCore(total, tankCount, scores[index] | 0);
}

/**
 * 같은 0x05F07 이되 DGROUP 을 직접 색인한다. 상점의 탱크 칸 0x05D44 가 이것을 부른다 —
 * 그쪽은 탱크 색인([bp+8])을 경계 검사 없이 `cbw ; imul 0x176` 하므로 `mine` 이 세그먼트를
 * 감아서 읽는 값일 수 있고, 배열 진입점으로는 그 감김을 표현할 수 없다. `total` 의 합
 * 루프는 색인이 0..count-1 이라 안 감긴다.
 *
 * @param dg        DGROUP 0x10000 바이트
 * @param tankIndex [bp+6] (0x05F07 기준). 부호 있는 바이트로 취급한다.
 */
export function scorePercentFromDgroup(dg            , tankIndex        )         {
  const count = sbyte(dg[u16(PLAYER_COUNT)]);                           // 0x05F38 cbw
  let total = 0;
  for (let i = 0; i < count; i++)
    total = i32(total + readI32(dg, u16(i * TANK_STRIDE + SCORE_LO)));  // 0x05F2D/0x05F31
  const mine = readI32(dg, u16(i16(tankIndex) * TANK_STRIDE + SCORE_LO)); // 0x05F97, 감긴 색인
  return scorePercentCore(total, count, mine);
}
