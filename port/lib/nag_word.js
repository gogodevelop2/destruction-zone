// 원본 DZONE.EXE 가 셰어웨어 안내문의 한 낱말을 한 글자씩 느리게 찍는 함수 재구현.
//
//   0x13F86  typeOutOneNagWord   낱말 하나를 글자마다 무작위 지연을 넣어 출력한다
//
// 바이트 근거는 disasm/addr_0x13F86.md 에 있다. 정답표는 goldens/nag_word_vectors_v1 이고
// port/test/nag_word.test.ts 가 그것으로 판정한다.
//
// 이 함수는 DGROUP 에 아무것도 안 쓰고 값도 안 돌려준다. 바깥에 남기는 것은 두 가지뿐이다
// — 0x136C6(calibrated busy-wait)을 어떤 인자로 부르는지, 그리고 printf(0x347C)로 무엇을
// 찍는지. 그래서 이 포트는 그 둘을 일어난 순서대로 담은 효과 목록을 돌려준다. 원본에서
// 로그포인트로 잡은 같은 목록이 정답표다.
//
// 안내문 표(DGROUP 0x1E1E)의 바이트는 글자에서 1 을 뺀 값이다. 그래서 '^' 는 0x5D 로
// 저장되고 출력 때 줄바꿈이 된다. 이 함수는 낱말 하나(0 으로 끝나는 저장 바이트 열)만
// 받는다. 표 전체를 낱말로 끊어 64→0 순서로 부르는 것은 부르는 쪽 0x13F00 이다.
//
// @원본 0x13F86

import { rand, srand } from "./rand.js";
import { lmul, sdiv } from "./borland_long.js";

const u16 = (v        )         => v & 0xffff;
const sbyte = (v        )         => (v << 24) >> 24;

/** 함수가 바깥에 내보내는 한 가지 동작. */
                       
                                                           
                                                                                      
                                                    
                                     // printf(" ")

/**
 * 원본 0x13F86 을, 부르는 지연과 찍는 글자를 순서대로 담아 돌려준다.
 *
 * 디스어셈블을 그대로 옮겼다. 관용적으로 고치지 않았고, 원본의 반복 구조와 갈래를
 * 주소째로 남겨 두었다.
 *
 * ```
 * di = 저장 바이트 열     si = 0
 * 0x13F93: jmp 0x1402E    -- 먼저 종료 검사로 뛴다 (빈 낱말이면 몸통을 안 돈다)
 * loop:
 *   0x1402E: if rec[si] == 0 -> 0x14038 (낱말 끝)
 *   0x13F96 몸통:
 *     if [0x4D8E] == 0:                        -- 미등록일 때만 지연
 *        [bp-2] 를 0..3 으로: 네 번
 *           r = rand()                          -- lcall 0x149D
 *           base = (90 * r) / 32768             -- flxmul 0x117A, 그다음 sdiv 0x11D6
 *           cls  = sbyte(rec[si]) < 0x61 ? 200 : 0   -- cmp; jge (부호 있는 비교), imul 0xC8
 *           0x136C6( base + cls + 60 )          -- add ax,dx; add ax,0x3C
 *     if [0x4D8E] == 0:                         -- 등록이면 찍지도 않는다
 *        if rec[si] == 0x5D: printf("\n")       -- 0x5D 는 '^' 의 저장형
 *        else:               printf("%c", sbyte(rec[si]) + 1)   -- cbw; inc; push
 *        if rec[si] == 0x2E: 0x136C6(1000)      -- 죽은 갈래. 저장 바이트는 0x2E 가 될 수
 *                                               --   없다(disasm anchor). 그래도 옮겨 둔다.
 *   0x1402D: si++ ; goto loop
 * 0x14038: 낱말 끝, si 는 종료 0 을 가리킨다
 *   if rec[si-1] == 0x5D: return               -- 낱말이 이미 줄을 바꿨다
 *   if [0x4D8E] != 0:     return
 *   r = rand(); 0x136C6( (400 * r) / 32768 + 250 )    -- 0x14048 묶음, add ax,0xFA
 *   printf(" ")
 *   r = rand(); 0x136C6( (400 * r) / 32768 + 250 )    -- 0x1407D 묶음, 위와 같다
 * ```
 *
 * `90 * r / 32768` 은 Borland 의 `rand() * n / 32768` 관용구다. 나눗셈은 부호 있는
 * 진입점(0x11D6)이지만 r 과 곱수가 다 양수라 결과도 양수다. 그래도 sdiv 로 옮긴 것은
 * 원본이 그 진입점을 부르기 때문이다.
 *
 * rec[si-1] 을 낱말 끝에서 읽는데, 빈 낱말이면 si 가 0 이라 rec[-1] 이 된다. 원본도
 * 버퍼 한 칸 앞을 읽는다(정의되지 않은 값). 부르는 쪽은 언제나 낱말을 넘기므로 실제로는
 * 생기지 않는 경우다.
 *
 * 원본 0x13F86 은 srand 을 안 부른다. rand 만 부른다. `seed` 를 주면 부르기 전에
 * srand 을 돌려 이 낱말 하나를 정해진 스트림에서 시작하게 한다(함수 정답표용). 안 주면
 * 지금 PRNG 자리에서 이어 쓴다 — 부르는 쪽 0x13F00 이 65개 낱말을 srand 없이 한 줄기
 * rand 스트림으로 찍는 것을 그대로 옮길 수 있게 하려는 것이다.
 *
 * @param rec     저장 바이트 열. 0 으로 끝난다 (글자 - 1 로 저장된 값들).
 * @param regFlag [0x4D8E] 의 바이트. 0 이 아니면 등록된 사본 — 지연도 출력도 건너뛴다.
 * @param seed    (선택) 부르기 전에 srand 에 넣을 16비트 씨앗. 원본에서는 0x3268 하위 워드.
 */
export function typeOutOneNagWord(
  rec                   ,
  regFlag        ,
  seed         ,
)              {
  if (seed !== undefined) srand(seed);
  const out              = [];
  const registered = (regFlag & 0xff) !== 0;

  let si = 0;
  while ((rec[si] ?? 0) !== 0) {
    const b = rec[si];

    if (!registered) {
      for (let k = 0; k < 4; k++) {
        const base = sdiv(lmul(90, rand()), 32768);
        const cls = sbyte(b) < 0x61 ? 200 : 0;
        out.push({ kind: "delay", arg: u16(u16(base + cls) + 60) });
      }
    }

    if (!registered) {
      if (b === 0x5d) {
        out.push({ kind: "newline" });
      } else {
        out.push({ kind: "char", value: u16(sbyte(b) + 1) });
      }
      if (b === 0x2e) {
        out.push({ kind: "delay", arg: 1000 });
      }
    }

    si++;
  }

  // 0x14038 — 낱말이 끝났다. si 는 종료 0 을 가리킨다.
  if ((rec[si - 1] ?? 0) === 0x5d) return out;
  if (registered) return out;

  out.push({ kind: "delay", arg: u16(sdiv(lmul(400, rand()), 32768) + 250) });
  out.push({ kind: "space" });
  out.push({ kind: "delay", arg: u16(sdiv(lmul(400, rand()), 32768) + 250) });
  return out;
}
