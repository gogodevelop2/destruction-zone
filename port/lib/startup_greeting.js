// 원본 DZONE.EXE 가 게임 시작 때 도는 안내 함수 재구현.
//
//   0x13F00  startupGreetingOrShareware   등록 사본이면 한 줄 인사, 미등록이면 셰어웨어
//                                         안내문을 낱말마다 느리게 찍는다
//
// 바이트 근거는 disasm/addr_0x13F00.md 에 있다. 정답표는 goldens/startup_greeting_vectors_v1
// 이고 port/test/startup_greeting.test.ts 가 그것으로 판정한다.
//
// 이 함수도 0x13F86 처럼 DGROUP 에 아무것도 안 쓰고(안내문 표를 지역 프레임으로 memcpy
// 할 뿐이다), 돌려주는 값 1 은 두 갈래가 만나는 자리에서 무조건 넣는 것이라 정보가 없다.
// 명령 수도 printf 와 C 런타임 때문에 못 쓴다. 그래서 정답표는 함수가 바깥에 내보내는
// 효과의 순서다 — 0x13F86 에 넘긴 낱말 순서(siSequence), 그리고 지연·글자·줄바꿈·빈칸과
// 끝의 갈래.
//
// PRNG 를 재시드하지 않는다. 원본 0x13F00 도 0x13F86 도 srand 을 안 부른다. 그래서 이
// 함수만 시작에서 srand 을 한 번 부르고, 65개 낱말은 한 줄기 rand 스트림으로 이어 찍는다.
// typeOutOneNagWord 를 씨앗 없이 부르면 그 자리 PRNG 를 이어 쓴다.
//
// @원본 0x13F00

import { readFileSync } from "../../web/shim.js";
import { fileURLToPath } from "../../web/shim.js";
import { srand } from "./rand.js";
import { typeOutOneNagWord,                } from "./nag_word.js";

/** 0x13F00 이 바깥에 내보내는 한 가지 동작. 0x13F86 의 효과에 갈래별 세 가지를 더한 것. */
                           
             
                                                                                                        
                                                                            
                                        // do getch(); while (kbhit()) — 버퍼를 비운다 (반복 수는 실행 시점 상태에 달렸다)

// 안내문 표: DGROUP 0x1E1E, 65개 x 14바이트, 글자에서 1 을 뺀 값으로 저장. '^' 는 0x5D 로
// 저장되어 출력 때 줄바꿈이 된다. 자리는 글꼴 표(port/lib/text.ts)와 같은 규칙 —
// DGROUP 이미지 오프셋 0x1AA60 + 파일 헤더 0x1600 + 오프셋.
const RECORD_COUNT = 65;
const RECORD_STRIDE = 14;

function nagTable()             {
  const dgroup = readFileSync(fileURLToPath(new URL("../data/DGROUP.BIN", import.meta.url)));
  const at = 0x1e1e;
  return new Uint8Array(dgroup.subarray(at, at + RECORD_COUNT * RECORD_STRIDE));
}

const TABLE = nagTable();

/**
 * 원본 0x13F00 을, 낱말 순서와 효과를 순서대로 담아 돌려준다.
 *
 * 디스어셈블을 그대로 옮겼다.
 *
 * ```
 * 0x13F16: memcpy(local, DS:0x1E1E, 0x38E)     -- 65 x 14 를 지역으로. 바깥에서 안 보인다.
 * 0x13F1B: si = 64
 * loop (0x13F3D: or si,si ; jge 0x13F20):
 *   0x13F20: if [0x4D8E] != 0 -> 0x13F3C       -- 등록이면 이 낱말을 건너뛴다 (매 반복 재확인)
 *   0x13F28: ax = si * 14 ; ax += &local       -- &local[si*14]
 *   0x13F38: 0x13F86(&local[si*14])            -- 낱말 하나를 느리게 찍는다
 *   0x13F3C: si--
 * 0x13F41: if [0x4D8E] != 0:
 *   0x13F50: printf("\n...REGISTERED TO %s.\n", 0x4D7A)
 *   0x13F5B: delay(2000)                       -- C 런타임 타이머
 * else:
 *   0x13F68: 0x136C6(5000)                     -- calibrated busy-wait
 *   0x13F6E: do getch(); while (kbhit())       -- 키보드 버퍼를 비운다
 * 0x13F7C: return 1                            -- 두 갈래가 여기서 만난다. 무조건.
 * ```
 *
 * 드레인 루프의 반복 횟수는 그때 키보드 버퍼에 무엇이 있느냐에 달렸다(그것을 비우려고
 * 있는 루프다). 함수의 성질이 아니므로 효과에는 `drainKeyboard` 하나만 남긴다.
 *
 * 원본 0x13F00 은 srand 을 안 부른다. 65개 낱말을 그 자리 PRNG 스트림으로 이어 찍는다.
 * `seed` 를 주면 부르기 전에 srand 을 돌려 정해진 스트림에서 시작하게 한다(이 함수의
 * 정답표용). 안 주면 지금 PRNG 자리에서 이어 쓴다 — 부르는 쪽 0x04C97 이 srand(time())
 * 을 한 뒤 이 함수를 부르는 것을 그대로 옮길 수 있게.
 *
 * @param regFlag [0x4D8E] 의 바이트. 0 이 아니면 등록된 사본.
 * @param seed    (선택) 부르기 전에 srand 에 넣을 16비트 씨앗. 원본에서는 0x3268 하위 워드.
 */
export function startupGreetingOrShareware(
  regFlag        ,
  seed         ,
)                                                                     {
  if (seed !== undefined) srand(seed);
  const registered = (regFlag & 0xff) !== 0;
  const effects                  = [];
  const siSequence           = [];

  for (let si = RECORD_COUNT - 1; si >= 0; si--) {
    if (!registered) {
      siSequence.push(si);
      const rec = TABLE.subarray(si * RECORD_STRIDE, si * RECORD_STRIDE + RECORD_STRIDE);
      for (const e of typeOutOneNagWord(rec, regFlag)) effects.push(e);
    }
  }

  if (registered) {
    effects.push({ kind: "printfRegistered" });
    effects.push({ kind: "delayTimer", ms: 2000 });
  } else {
    effects.push({ kind: "delay", arg: 5000 });
    effects.push({ kind: "drainKeyboard" });
  }

  return { result: 1, siSequence, effects };
}
