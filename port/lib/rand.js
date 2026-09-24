// 게임의 유일한 난수원. Borland C 의 rand/srand 재구현.
//
// 원본: disasm/addr_0x0149D.md (rand), disasm/addr_0x0148C.md (srand).
// 뜻과 근거는 analysis/borland_helpers.md 의 "난수" 절.
// 맞는지는 goldens/rand_vectors_v1/vectors.json 이 판정한다
// (port/test/rand.test.ts).
//
// 씨앗은 원본에서 DGROUP 0x3268(하위 워드)과 0x326A(상위 워드)에 있는 32비트 하나다.
// 여기서는 그 한 자리를 그대로 하나만 둔다 — 게임에도 하나뿐이다.
// @원본 0x0148C 0x0149D

import { u32, lmul } from "./borland_long.js";

/** 원본 0x014A5/0x014A8 에 박혀 있는 상수 0x015A:0x4E35. */
export const LCG_MULTIPLIER = 0x015a4e35;

export const state = { seed: 0 };

/**
 * srand(x). 원본은 16비트 인자를 하위 워드에 넣고 상위 워드를 0 으로 지운다.
 * 그래서 **닿을 수 있는 시작 씨앗이 0x0000..0xFFFF 뿐이다** — 32비트 전체가 아니다.
 */
export function srand(x        )       {
  state.seed = u32(x & 0xffff);
}

/** 씨앗 하나를 한 걸음 굴린다. 상태를 안 건드리므로 정답표 대조에 쓴다. */
export function randStep(seed        )                                   {
  const next = u32(lmul(LCG_MULTIPLIER, seed) + 1);
  return { next, result: (next >>> 16) & 0x7fff };
}

/** rand(). 씨앗을 굴리고 상위 워드의 아래 15비트를 낸다 (0..32767). */
export function rand()         {
  const { next, result } = randStep(state.seed);
  state.seed = next;
  return result;
}
