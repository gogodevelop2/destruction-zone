// 원본 DZONE.EXE 의 시작 루틴 재구현 — PRNG 씨앗 + 속도 보정.
//
//   0x04C97  startupSeedAndSpeedCalibration   main 의 첫 문장. 다섯 가지를 순서대로 한다.
//
// 바이트 근거는 disasm/addr_0x04C97.md 에 있다. 정답표는 goldens/startup_calibration_vectors_v1
// 이고 port/test/startup_calibration.test.ts 가 그것으로 판정한다.
//
//   1. srand(time(NULL))          -- 0x160B(DOS 날짜+시각) → srand(0x148C). 씨앗은 호스트 시계.
//   2. readDzoneCnf()             -- 0x05BA0 (cnf_read.ts)
//   3. loadDzoneKeySettings()     -- 0x13B00 (dzone_key.ts). [0x4D79]/[0x4D6B]/[0x4D6C]/[0x4D8E] 를 채운다.
//   4. graphicsInitOrMode(1, [0x4D79])   -- 0x13A7F (graphics_init.ts)
//   5. 속도 보정 + 0x140B:0x0E53() + startupGreetingOrShareware() → [0x1337] = 반환 바이트 (늘 1)
//
// ## 무엇이 측정 계약에 매이는가 (goldens/startup_calibration_vectors_v1/README.md 참조)
//
//   - raw: 보정 루프가 4 BIOS 틱 동안 도달하는 BGI 그리기 횟수. profile.yaml 의 cycles·
//     machine 에 매인다. **재현되지 않는다** — 실측에서 연속 두 번이 5478, 5479 로 ±1
//     흔들렸다. 그래서 이 포트는 raw 를 계산하지 않고 **입력으로 받는다**.
//   - 최종 [0x4D6F]/[0x4D6D]: raw 를 통해 계약에 매인다. 현재 계약에서는 클램프(1300)에
//     걸려 raw 가 흔들려도 1300 으로 안정. anchor 시절 골든은 1131 이었다.
//   - PRNG 씨앗: time(NULL) 이라 에뮬레이터의 고정 부팅 시각에 매인다. 이 포트는 씨앗도
//     입력(clockSeed)으로 받는다.
//
// ## 무엇이 안 매이는가 — 여기 함수 정답표가 붙는 부분
//
//   - calibrationMultiplier / calibrationScale: 주어진 (raw, mode, trimSub, trimAdd) 에서
//     순수 산술이다. 원본을 0x04D48(스케일 구간)에 진입시켜 네 자리를 프리셋하고 받은
//     답 12개로 판정한다.
//
// @원본 0x04C97

import { u32, lmul, sdiv } from "./borland_long.js";
import { srand } from "./rand.js";
import { readDzoneCnf,                } from "./cnf_read.js";
import { loadDzoneKeySettings,                     } from "./dzone_key.js";
import { graphicsInitOrMode,                } from "./graphics_init.js";
import { startupGreetingOrShareware,                    } from "./startup_greeting.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

/**
 * 04D4F..04D85 의 속도 배수. 전부 16비트 산술이다.
 *
 * ```
 * ax = 0x14 ; ax -= sbyte([0x4D79])                    -- 04D54, 04D58
 * ax += ([0x4D79] == 1 ? 0x14 : 0)                     -- 04D5B..04D71 (imul dx, dx=0x14)
 * ax -= sbyte([0x4D6C])                                -- 04D74..04D7B
 * ax += sbyte([0x4D6B])                                -- 04D7E..04D85
 * cdq(cwd)  -- 부호 있게 확장                            -- 04D87
 * ```
 *
 * anchor 로 교차 확인: mode 2 → 18, mode 1 → 39. 정답표의 mode 0/5·trim 경우가 원본으로
 * 이를 판정한다.
 */
export function calibrationMultiplier(mode        , trimSub        , trimAdd        )         {
  let ax = u16(0x14 - sbyte(mode));
  ax = u16(ax + ((mode & 0xff) === 1 ? 0x14 : 0));
  ax = u16(ax - sbyte(trimSub));
  ax = u16(ax + sbyte(trimAdd));
  return i16(ax);
}

/**
 * 04D87..04DB5 의 스케일·클램프.
 *
 * ```
 * ax = [0x4D6F] + 0xA          -- 16비트. raw+10.
 * cdq(cwd)  -- ax 를 부호 있게 32비트로. raw >= 32758 이면 raw+10 이 음수로 접힌다.
 * FLXMUL( (raw+10)_long, mul_long )   -- 0x117A. 32비트 곱, 넘치는 자리 버림.
 * sdiv( product, 43 )                 -- 0x11D6. 부호 있는 나눗셈, 0 쪽으로 자름.
 * [0x4D6F] = ax                       -- 몫을 워드로 저장
 * if ([0x4D6F] > 1300) [0x4D6F] = 1300   -- cmp ...,0x514 ; jle. 부호 있는 비교라 음수는 클램프 안 함.
 * [0x4D6D] = [0x4D6F]
 * ```
 *
 * 정답표로 확인한 것: raw=40000 → raw+10=40010 이 부호 있는 16비트로 -25526 이 되어
 * 결과가 음수(-10685, 워드로 54851)로 나오고 클램프가 안 걸린다. raw=65535 → raw+10 이
 * 16비트로 9 가 되어 결과 3.
 *
 * @param raw 보정 루프 횟수 (측정 계약에 매인 값. 부르는 쪽이 잰다).
 * @param mul calibrationMultiplier 의 결과.
 */
export function calibrationScale(raw        , mul        )                                   {
  const n = i16(u16(raw + 0xa));
  const prod = lmul(u32(n), u32(mul));
  let v = i16(sdiv(prod, 43));
  if (v > 1300) v = 1300;
  const d4D6F = u16(v);
  return { d4D6F, d4D6D: d4D6F };
}

/**
 * 원본 0x04C97 전체. raw 와 clockSeed 는 측정 계약에 매인 값이라 부르는 쪽이 잰다.
 *
 * @param clockSeed    time(NULL) 의 값 (16비트로 잘린다). 고정 부팅 시각에 매임.
 * @param rawDrawCount 보정 루프가 도달한 그리기 횟수. cycles·machine 에 매임. 재현 안 됨.
 * @param cnfFile      dzone.cnf 바이트 (또는 열기 실패면 null).
 * @param keyFile      dzone.key 바이트 (또는 열기 실패면 null. 실패면 원본은 exit(1)).
 */
export function startupSeedAndSpeedCalibration(inp   
                    
                       
                             
                             
 )   
                   
                 
                      
                   
                
                
                
                                                          
  {
  // 1. srand(time(NULL)) — 0x160B 값을 그대로 0x148C 로.
  const prngSeed = u16(inp.clockSeed);
  srand(prngSeed);

  // 2. dzone.cnf
  const cnf = readDzoneCnf(inp.cnfFile);

  // 3. dzone.key
  const key = loadDzoneKeySettings(inp.keyFile);
  if (key.openFail) {
    // 원본은 여기서 exit(1) 한다. 이 경로는 돌아오지 않는다.
    throw new Error("dzone.key 열기 실패 — 원본은 exit(1). 시작을 이어갈 수 없다.");
  }

  // 4. 그래픽 (인자 1). [0x4D79] 는 방금 3번이 넣었다.
  const gfx = graphicsInitOrMode(1, key.b_4D79);

  // 5. 속도 보정
  const mul = calibrationMultiplier(key.b_4D79, key.b_4D6C, key.b_4D6B);
  const { d4D6F, d4D6D } = calibrationScale(inp.rawDrawCount, mul);

  // 0x140B:0x0E53() — 인자 없는 BGI 호출, 값 안 냄, 미식별. 바깥으로 나가는 것이 없어
  // 효과 목록에 안 담는다 (disasm/addr_0x04C97.md 의 uncertain).

  // 0x13F00 — srand 없이 (1번이 씨앗을 이미 넣었다). registered 면 rand 를 안 뽑는다.
  const greeting = startupGreetingOrShareware(key.b_4D8E);
  const d1337 = greeting.result & 0xff; // 0x13F00 은 늘 1 을 낸다

  return { prngSeed, cnf, key, gfx, d4D6F, d4D6D, d1337, greeting };
}
