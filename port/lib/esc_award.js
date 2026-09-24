// 원본 0x0DFEB (esc-quit-award) 를 옮긴 것이다.
//
// 게임 루프(0x0AC29)가 라운드 끝 바이트 [0x4D66] 이 2 일 때만 이 함수를 부르고, 그 2 를
// 세우는 것이 어제 옮긴 스캔코드 디스패처의 ESC 경로다(scancode_dispatch.ts, [ROUND_MODE]==0
// 이고 스캔코드 1 이면 [ROUND_END]=2). 즉 라운드 도중에 ESC 를 누르면 이 함수가 돈다.
// rom/DZONE.DOC 4쪽: "ESC 를 누르면 남은 플레이어들이 각 탱크의 무기 에너지와 실드
// 에너지에 따라 예상 점수와 상금을 받는다."
//
// 이 함수는 DGROUP 만 읽고 쓴다. 화면도 파일도 안 만진다. 32비트 곱셈·나눗셈만
// borland_long.ts 의 것을 그대로 부른다 (원본은 lcall 0,0x117A / lcall 0,0x11D6).
//
// ── 필드 (탱크 레코드 = DGROUP 0x43FC + p*0x176) ──────────────────────────────
// +0x02  바이트  0 이면 그 탱크가 살아서 그려진다. 격추되면 1 이 된다
//                (analysis/damage_and_scoring.md — 실드 0 → +0x02=1 "안 그려지게",
//                검사 live-tank-count-matches-flags 가 [0x4D72] == (+0x02==0 인 수) 를
//                127,306 프레임에서 위반 0 으로 확인). ⚠ 그 문서는 격추 말고 다른 이유로도
//                +0x02 가 켜지는 표본이 있다고 남겨 뒀다(파괴 탱크 359,907 중 30,049 에서
//                +0x26 != 0). 그래서 "== 0 이면 대전에 살아 있다" 까지만 확실하다.
// +0x22  워드    실드 0..400 (라운드 시작 400) — analysis/tank_gauges.md
// +0x26  바이트  무기 에너지 0..100 (라운드 시작 100) — analysis/tank_gauges.md
// +0x28  롱      점수. 0x05F07(score.ts)이 "평균 대비 퍼센트" 로 읽고, 격추 시 +30,
//                피해 시 +dmg. 라운드/대전 초기화가 0 으로 세운다(0x079AE).
// +0x30  롱      크레딧. 상점 0x05FB3 이 여기서 물건 값을 뺀다(-800, -1200, 가변).
//                피해 시 +0x28 과 같은 양을 더한다 — analysis/damage_and_scoring.md:164,
//                검사 score-leads-credits-by-the-kill-bonus / credits-drop-only-at-round-end.
// +0x34  바이트  고른 무기 색인 (탱크의 무기 배열 +0x49 를 색인, damage_and_scoring.md:51).
// 오토파일럿 배열 = DGROUP 0x4CC0 + p*0x15, +0x00 = 기량 1..5 (사람 자리면 0).
//
// ── 원본이 "실행해 봐야 안다" 고 남겼던 세 가지, 어떻게 풀렸나 ────────────────────
// 1. 상금 계산식의 묶이는 순서 — 아래 트레이스대로다. 스택을 거치는 곱하기·나누기 네
//    번을 원본 명령 하나하나 따라가서 얻었고, goldens/esc_award_vectors_v1 이 원본을
//    불러 판정한다(포트가 순서를 잘못 잡으면 +0x28/+0x30 에 쓰는 롱이 갈린다).
//    무엇이 잡았나: 정적 재확인 + 끝단 대조.
// 2. +0x28 과 +0x30 중 무엇이 점수이고 무엇이 크레딧인가 — 이 함수는 **같은 값을 둘 다에
//    더하므로 이 함수만으로는 못 가른다.** 이미 옮긴 코드와 아직 안 옮긴 상점이 가른다:
//    score.ts(0x05F07)가 +0x28 을 점수로 읽고, 상점 0x05FB3 이 +0x30 에서 값을 뺀다
//    (0x0616D `sub [bx+0x442c],0x320` 등). analysis/damage_and_scoring.md 가 "+0x30 은
//    크레딧" 이라고 실측으로 적었다. ⇒ +0x28 = 점수, +0x30 = 크레딧. 무엇이 잡았나:
//    두 번째 소비자(score.ts) + 정적 재확인(상점의 빼기).
// 3. 기록 +0x02 의 뜻 — 위 필드 표. == 0 이면 대전에 살아 있고(그래서 상금 대상),
//    격추되면 켜진다. 무엇이 잡았나: 정적 재확인 + 술어 검사(live-tank-count-matches-flags).
//
// ── 안쪽 합에 자기 자신이 들어간다 ────────────────────────────────────────────
// 안쪽 루프는 di != si 를 안 본다. 상금 받는 플레이어 si 도 살아 있으므로(바깥 게이트를
// 통과했다) 자기 실드가 S22 에, 자기 무기 에너지가 S26 에 함께 들어간다. 즉 자기
// 에너지가 분자(S22)와 분모(S26+5)에 같이 놓인다 — 이 게임의 성질이다.
//
// @원본 0x0DFEB

import { sdiv, lmul, i32, u32 } from "./borland_long.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

const TANK_BASE = 0x43fc, TANK_STRIDE = 0x176;
const ALIVE = 0x02;           // == 0 이면 대전에 살아 있다
const SHIELD = 0x22;          // 워드
const WEAPON_E = 0x26;        // 바이트
const SCORE = 0x28;           // 롱
const CREDITS = 0x30;         // 롱
const WEAPON_SEL = 0x34;      // 바이트, 고른 무기 색인
const AUTOPILOT = 0x4cc0, AUTOPILOT_STRIDE = 0x15;
const PLAYER_COUNT = 0x4d73;  // 바이트, 부호 있게(cbw) 읽는다

function readI32(dg            , at        )         {
  return u32(dg[u16(at)] | (dg[u16(at + 1)] << 8) | (dg[u16(at + 2)] << 16) | (dg[u16(at + 3)] << 24));
}
function addI32(dg            , at        , delta        )       {
  const v = u32(readI32(dg, at) + delta);   // 원본은 add/adc — 32비트에서 감긴다
  dg[u16(at)] = v & 0xff;
  dg[u16(at + 1)] = (v >>> 8) & 0xff;
  dg[u16(at + 2)] = (v >>> 16) & 0xff;
  dg[u16(at + 3)] = (v >>> 24) & 0xff;
}

/**
 * 원본 0x0DFEB. 인자를 안 받고 DGROUP 전역만 읽고 쓴다.
 *
 * 살아 있는 각 플레이어에게 예상 점수·상금을 준다. 트레이스:
 * ```
 * for si in 0 .. sbyte([0x4D73])-1:
 *   base = si*0x176
 *   if [base+0x43FE] != 0:        continue     ; 죽음
 *   if [base+0x4430] == 0:        continue     ; 무기 미선택
 *   if [si*0x15 + 0x4CC0] == 0:   continue     ; 오토파일럿/기량 0 (사람 자리)
 *   S22 = Σ_{p alive} i16([p*0x176 + 0x441E])          ; 실드 합
 *   S26 = Σ_{p alive} sbyte([p*0x176 + 0x4422])        ; 무기 에너지 합
 *   W   = i16([base+0x441E])                            ; 자기 실드
 *   E   = sbyte([base+0x4422])                          ; 자기 무기 에너지
 *   q1    = sdiv( lmul(S22, E + 3), S26 + 5 )
 *   award = sdiv( lmul(W, q1), 400 )                    ; 0x190 = 400
 *   [base+0x4424] (롱) += award                          ; 점수
 *   [base+0x442C] (롱) += award                          ; 크레딧
 * ```
 * 두 나눗셈은 0 쪽으로 자르는 부호 있는 나눗셈(sdiv, 원본 0x11D6), 두 곱셈은 넘침을
 * 버리는 32비트 곱셈(lmul, 원본 0x117A).
 *
 * ⚠ 첫 나눗셈의 분모가 S26 + 5 다. 살아 있는 자들의 무기 에너지 합 S26 이 -5 면 0 이
 *   된다. 실제 게임 상태에서는 +0x26 이 0..100 이라(analysis/tank_gauges.md) 안 닿지만,
 *   닿으면 **원본은 나눗셈 예외(INT 0)로 죽는다** — Borland 런타임이 프로그램을 끝낸다.
 *   그래서 이 자리는 "못 보는 자리" 가 아니라 **원본에 답이 없는 자리**다. sdiv 가 0
 *   제수에 던지므로 포트도 그럴듯한 값을 내지 않고 크게 실패한다 (2026-09-06 hold-out).
 */
export function escQuitAward(dg            )       {
  for (let si = 0; sbyte(dg[PLAYER_COUNT]) > si; si++) {
    const base = u16(TANK_BASE + si * TANK_STRIDE);
    if (dg[u16(base + ALIVE)] !== 0) continue;
    if (dg[u16(base + WEAPON_SEL)] === 0) continue;
    if (dg[u16(si * AUTOPILOT_STRIDE + AUTOPILOT)] === 0) continue;

    let s22 = 0, s26 = 0;
    for (let di = 0; sbyte(dg[PLAYER_COUNT]) > di; di++) {
      const b = u16(TANK_BASE + di * TANK_STRIDE);
      if (dg[u16(b + ALIVE)] !== 0) continue;
      s22 = i32(s22 + i16(dg[u16(b + SHIELD)] | (dg[u16(b + SHIELD + 1)] << 8)));
      s26 = i32(s26 + sbyte(dg[u16(b + WEAPON_E)]));
    }

    const w = i16(dg[u16(base + SHIELD)] | (dg[u16(base + SHIELD + 1)] << 8));
    const e = sbyte(dg[u16(base + WEAPON_E)]);
    const q1 = sdiv(lmul(u32(s22), u32(e + 3)), u32(s26 + 5));
    const award = i32(sdiv(lmul(u32(w), q1), 400));

    addI32(dg, base + SCORE, award);
    addI32(dg, base + CREDITS, award);
  }
}
