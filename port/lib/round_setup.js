// 원본 DZONE.EXE 의 라운드 설정 0x07C95 를 재구현한다.
//
// 부르는 곳은 게임 루프 0x0AC29 의 0x0AC3E 하나이고, 그 자리는 반복 최상단 0x0AC41 보다
// 위다. 그래서 라운드마다 한 번 돈다. retf 하나로 끝나고 exit 갈래는 없다.
//
// 하는 일은 일곱 단계다.
//   1. 자리 표 6바이트를 DGROUP 0x1D2F 에서 지역 배열로 복사하고, 0x4D67(남은 라운드)을
//      하나 줄이고, 기준 각 di = rand()*360/32768 을 뽑는다.
//   2. 팀 모드(0x4D65 != 0)면 표식 둘(0x33DC + i*32, i=1,2)을 경기장 중앙 둘레에 놓고
//      각속도·각을 정한다. 아니면 각 증가폭을 360/0x4D73 으로 둔다 (팀 모드는 6).
//   3. 놓는 순서. 팀 모드면 0,1,2,... 아니면 거절 뽑기로 만든 순열.
//   4. 탱크마다 위치·각·팀을 정하고 필드를 되돌린다. +0x34 가 0 이면 0x121E2 를 부른다.
//   5. 전역 라운드 상태를 되돌리고 비율 상수 0x4D63 을 다시 계산한다.
//   6. 0x084EB(경기장 배치와 첫 그리기)를 부른다.
//   7. 자리 번호 순으로 탱크 색을 팔레트 사본에서 옮기고 색 점멸을 끈다.
//
// ── 원본을 그대로 따른 흠 ────────────────────────────────────────────────────
// · 2단계의 si 는 탱크 수가 2·4·6 일 때만 0·3·6 으로 정해진다. 팀 모드에서 탱크 수가
//   그 밖이면 si 는 부른 쪽이 남긴 레지스터 값 그대로다. 그래서 이 포트는 진입 때의 si 를
//   인자로 받는다.
// · 4단계의 ox·oy 는 imul dx 가 만든 32비트 곱을 바로 다음 cwd 가 16비트로 자른다
//   (0x08118, 0x08150). 곱이 나눗셈 전에 16비트로 잘린다.
// · 자리 표와 놓는 순서는 스택의 6칸 배열이다. 탱크 수가 7 이상이면 서로의 칸과 지역
//   변수를 덮는다. 그 자리는 옮기지 않고 멈춘다.
//
// ── 난수를 쓰는 횟수 ─────────────────────────────────────────────────────────
// 기준 각 1, 표식마다 1 (팀 모드), 순열의 뽑기마다 1 (팀 모드가 아닐 때, 거절된 뽑기 포함),
// 탱크마다 3 (+0x71, +0x73, +0x74). 거절 뽑기 하나만 어긋나도 뒤의 난수 열이 전부 밀린다.
// 6단계의 경기장 배치는 화면에 막힌 장애물을 다시 뽑으므로 거기서부터는 화면에 매인다.
//
// 비율 상수 0x4D63 은 기계 속도(0x4D6D 를 0x4D6F 로 되돌린 값)를 살아 있는 탱크 수로 나눈
// 값이다. 실측값을 넣으면 1131 / 12 = 94 이고 런타임에서 읽은 값과 같다.
//
// 씨앗은 DGROUP 0x3268(하위)·0x326A(상위)에 있고, 뽑을 때마다 거기서 읽고 거기에 쓴다.
// host 가 부르는 두 함수도 같은 자리를 본다.
//
// 라운드 시작 때의 탱크 레코드 모양(여러 함수가 읽는다): analysis/round_setup.md.
// 정답표: goldens/round_setup_vectors_v1/ (탱크 배치, 합성 DGROUP),
//         goldens/round_setup_full_vectors_v1/ (함수 전체, 상태 표본 DGROUP)
// @원본 0x07C95
import { sdiv, lmul, i32 } from "./borland_long.js";
import { sine, cosine } from "./trig.js";
import { randStep } from "./rand.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;
/** Borland 32비트 부호 있는 나눗셈 (0x011D6). 0 쪽으로 자른다. */
const sd = (a        , b        )         => i32(sdiv(a, b));
/** 16비트 cwd; idiv. 몫과 나머지 둘 다 0 쪽으로 자른 값이다. 원본이 INT 0 으로 죽는
 *  자리(0 으로 나누기, 몫이 16비트를 넘음)에서는 멈춘다. */
function idiv16(a        , b        )                           {
  const q = Math.trunc(i16(a) / i16(b));
  if (i16(b) === 0 || q !== i16(q)) throw new Error(`idiv16: ${i16(a)} / ${i16(b)} — 원본은 INT 0`);
  return { q, r: i16(a) % i16(b) };
}

const TANK = 0x43fc, STRIDE = 0x176;
const SEED = 0x3268;
const GEOMETRY = 0x1241;          // 화면 모드 * 4 로 색인. +0 = W, +2 = H
const TAKEN_INIT = 0x1d2f;        // 자리 표의 처음 값 6바이트
const MARKER = 0x33dc, MARKER_STRIDE = 32;
const SLOT_COLOUR = 0x126f, COLOUR_CACHE = 0x33ac;

                                 
                                                            
                                   
                                                             
                      
 

/**
 * 0x07C95. dg 는 64KiB DGROUP 이고 그 자리에서 고친다.
 * @param siIn 진입 때의 si. 팀 모드에서 탱크 수가 2·4·6 이 아닐 때만 결과에 쓰인다.
 */
export function runRoundSetup(host                , dg            , siIn        )       {
  const rd8 = (a        ) => dg[u16(a)];
  const rd16 = (a        ) => dg[u16(a)] | (dg[u16(a + 1)] << 8);
  const wr8 = (a        , v        ) => { dg[u16(a)] = v & 0xff; };
  const wr16 = (a        , v        ) => { wr8(a, v); wr8(a + 1, v >> 8); };
  const wr32 = (a        , v        ) => { wr16(a, v); wr16(a + 2, v >>> 16); };
  const rd32 = (a        ) => (rd16(a) | (rd16(a + 2) << 16)) >>> 0;
  const draw = ()         => {
    const r = randStep(rd32(SEED));
    wr32(SEED, r.next);
    return r.result;
  };
  /** rand() * n / 32768 — lmul 뒤 32768 로 나눈다 */
  const drawTimes = (n        )         => sd(lmul(draw(), n), 0x8000);

  const count = sbyte(rd8(0x4d73));
  if (count > 6) throw new Error(`runRoundSetup: 탱크 수 ${count} — 스택 배열 6칸을 넘는다`);
  const team = sbyte(rd8(0x4d65)) !== 0;
  const geo = u16(sbyte(rd8(0x4d79)) << 2);
  const W = () => i16(rd16(GEOMETRY + geo));
  const H = () => i16(rd16(GEOMETRY + 2 + geo));
  const rec = (t        ) => u16(TANK + i16(t * STRIDE));

  // 1단계 — 0x07C9D..0x07CD5
  const taken = [...dg.subarray(TAKEN_INIT, TAKEN_INIT + 6)];
  wr8(0x4d67, rd8(0x4d67) - 1);
  let di = i16(drawTimes(360));
  let si = i16(siIn);

  // 2단계 — 0x07CD7..0x07FC1
  let step        ;
  if (team) {
    step = 6;
    if (count === 2) si = 0;
    if (count === 4) si = 3;
    if (count === 6) si = 6;
    // 중심 = 20 * ((반폭 + 삼각 * (폭/k1) / 115) / 20) + 15.  X 는 W-39 와 코사인·21,
    // Y 는 H 와 사인·22. 32비트 나눗셈과 곱셈이 섞인다.
    const centre = (span        , k1        , trig                       , off        ) => {
      const q1 = sd(span, k1);
      const ang = i16(idiv16(di + si + off, 360).r * 50);
      const q2 = sd(lmul(i16(trig(ang)), q1), 115);
      const sum = i32(idiv16(span, 2).q + q2);
      return u16(lmul(sd(sum, 20), 20) + 15);
    };
    for (const [i, off] of [[1, 26], [2, 206]]) {
      const m = MARKER + i * MARKER_STRIDE;
      wr16(m + 0x00, centre(i16(W() - 39), 21, cosine, off));
      wr16(m + 0x02, centre(H(), 22, sine, off));
    }
    for (let i = 1; i <= 2; i++) {       // 0x07F4B..0x07FB1
      const m = MARKER + i * MARKER_STRIDE;
      wr16(m + 0x16, 500);
      wr16(m + 0x14, drawTimes(18000));
      wr32(m + 0x1c, rd32(m + 0x18));
    }
  } else {
    step = idiv16(360, count).q;         // 0x07FB5
  }

  // 3단계 — 놓는 순서 (0x07FC4..0x0804E). 거절된 뽑기도 난수를 하나 쓴다.
  const order           = [];
  if (team) {
    for (let k = 0; k < count; k++) order.push(k);
  } else {
    for (let k = 0; k < count; k++) {
      let t        ;
      do t = i16(drawTimes(count)); while (taken[t] !== 0);
      taken[t] = 1;
      order.push(t);
    }
  }

  // 4단계 — 탱크마다 (0x08050..0x083C2)
  const half = idiv16(count, 2).q;
  for (let k = 0; k < count; k++) {
    const t = sbyte(order[k]);
    const b = rec(t);
    di = idiv16(di + step, 360).r;
    si = team && t >= half ? idiv16(di + 180 - i16(half * 6), 360).r : di;

    wr8(b + 0x03, team ? (t < half ? 1 : 2) : 0);
    // ⚠ imul dx 의 32비트 곱을 다음 cwd 가 16비트로 자른다 (0x08118, 0x08150)
    const ox = idiv16(i16(idiv16(W() + 151, 60).q * cosine(i16(si * 50))), 46).q;
    const oy = idiv16(i16(idiv16(H() + 130, 60).q * sine(i16(si * 50))), 44).q;
    wr8(b + 0x80, 0);
    wr8(b + 0x02, 0);
    wr8(b + 0x26, 100);
    wr8(b + 0x27, 100);
    wr16(b + 0x22, 400);
    wr16(b + 0x24, 400);
    wr32(b + 0x09, lmul(i32(idiv16(W() - 39, 2).q + ox), 50));
    wr32(b + 0x0d, lmul(i32(idiv16(H(), 2).q + oy), 50));
    wr16(b + 0x11, idiv16(si + 180, 360).r * 50);
    wr8(b + 0x61, 0);
    wr16(b + 0x71, drawTimes(30000));
    wr16(b + 0x6d, 0xffff);
    wr8(b + 0x04, 0);
    wr8(b + 0x05, 0);
    wr16(b + 0x07, 0);
    wr8(b + 0x81, 0);
    wr8(b + 0x73, drawTimes(count) + 1);
    wr8(b + 0x74, drawTimes(count) + 1);
    wr8(b + 0x7b, 0xff);
    wr32(b + 0x2c, rd32(b + 0x28));
    if (rd8(b + 0x34) === 0) host.changeWeapon(t & 0xff);
  }

  // 5단계 — 전역 라운드 상태 (0x083C7..0x0841D)
  for (const a of [0x4d66, 0x4d62, 0x4d71, 0x4d90, 0x4d8f]) wr8(a, 0);
  wr8(0x4d72, rd8(0x4d73));
  wr16(0x4d75, 0);
  wr16(0x4d6f, rd16(0x4d6d));
  const denom = i16(sbyte(rd8(0x4d72)) * 2 + sbyte(rd8(0x4d65)) + idiv16(rd8(0x4d71), 4).q);
  wr16(0x4d63, idiv16(rd16(0x4d6f), denom).q);
  if (i16(rd16(0x4d63)) < 20) wr16(0x4d63, 20);

  // 6단계
  host.arenaLayout();

  // 7단계 — 자리 번호 순. 사본의 둘째·셋째를 엇갈려 넣는다 (0x08428..0x084E2)
  for (let i = 0; i < count; i++) {
    const c = u16(COLOUR_CACHE + i16(sbyte(rd8(SLOT_COLOUR + i)) * 3));
    const b = rec(i);
    wr8(b + 0x67, rd8(c));
    wr8(b + 0x69, rd8(c + 1));
    wr8(b + 0x68, rd8(c + 2));
    wr16(b + 0x62, 0);
    wr8(b + 0x66, 0);
    wr8(b + 0x65, 0);
    wr8(b + 0x64, 0);
  }
}
