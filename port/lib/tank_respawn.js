// 원본 DZONE.EXE 0x12FD5 — 탱크마다 도는 색-깜빡임 상태 기계와 리스폰 배치.
//
//   0x12FD5  tankColourFlashAndRespawn()
//
// 부르는 곳은 메인 게임 루프 0x0AC29 하나(0x0AC77)라 프레임마다 한 번 돈다.
// 바이트 근거는 disasm/addr_0x12FD5.md. 이 함수의 뜻은 아래 주석으로 접었다 —
// analysis/tank_colour_and_respawn.md 와 disasm 의 note 를 여기로 옮기고 원본에서 지웠다.
// @원본 0x12FD5
//
// ── 무엇을 하는가 ────────────────────────────────────────────────────────────
// 탱크마다(0x4D73 개), 그 탱크의 +0x445E(깜빡임 타이머)가 0 이 아니면 색-깜빡임을
// 한 걸음 진행한다. 타이머는 매 프레임 1 늘고, `+0x445E % ([0x4D63]/14) == 0` 인 프레임
// 에만 실제로 한 걸음 나아간다.
//
// 한 걸음: +0x4460(부호 있는 스텝)을 정방향이면 +1, 역방향(음수)이면 -1.
//   · 스텝 >= 0 (정방향, 1..10): 색을 base 에서 target 으로 스텝/10 만큼 선형 보간해
//     `int 0x10` AX=1010h 로 그 탱크의 팔레트 레지스터 하나를 쓴다 (호출 스캔에 안
//     잡히는 자리다 — anchor 가 짚었다). 스텝이 10 에 닿으면 base←target 을 넣고,
//       - +0x4461(리스폰 대기 플래그) != 0 이고 스테이지(+0x4462)가 짝수 → 리스폰.
//       - 그 밖에 스테이지가 홀수 → 스텝을 -1 로 놓아 역방향 다리를 시작.
//       - 리스폰 플래그 0 이고 스테이지 짝수 → 타이머 0, 스테이지 0 으로 놓아 멈춘다
//         (시퀀스가 스스로 꺼진다 — anchor 의 실험이 확인).
//   · 스텝 < 0 (역방향): 색을 안 건드린다. 스텝이 -40 (스테이지가 정확히 3 이면 -80)
//     에 닿으면 스테이지 +1, 스텝 0, 타이머 1, target 을 팔레트 캐시(0x33AC[슬롯])로
//     되돌린다.
//
// ── 리스폰 배치 ──────────────────────────────────────────────────────────────
// 탱크를 지우고(0xF256(t,1)), 새 자리를 뽑는다:
//   x = (rand() * (W - 80) / 32768 + 20) * 50     +0x4405 에 32비트 (1/50 픽셀)
//   y = (rand() * (H - 40) / 32768 + 20) * 50     +0x4409
// W, H 는 화면 크기 표 0x1241 을 화면 모드 0x4D79 로 찾은 값이라 해상도에 따라 커진다.
// 그다음 삼각형 세 꼭짓점을 각도(+0x440D)로 돌리고:
//   vx = x/50 + (ox*cos(a) - oy*sin(a)) / 750
//   vy = y/50 + (ox*sin(a) + oy*cos(a)) / 750
// ox, oy 는 꼭짓점 표 0x1251(모양 색인 +0x43FD, 6바이트 걸음) 의 부호 있는 바이트.
// 세 변을 선 탐침(0x46CA)으로 검사한다(받는 색 8=바닥 / 슬롯 / 15). 한 변이라도
// 막히면 새 난수로 다시 뽑는다 — 횟수 제한이 없다.
//
// ── 루프 뒤 소리 (0x13650~) ─────────────────────────────────────────────────
// [0x4D75] 가 0 이 아니면 [0x4D75]/8 + 1 번 돌며 매번 sound(500 - i*10),
// wait(rand()*7/32768 + 4), nosound(). 끝에 [0x4D75] /= 5.
//
// ── 이미 옮긴 포트와의 맞물림 ────────────────────────────────────────────────
// 순수 산술(lmul/sdiv, rand, sine/cosine)은 아래에서 그대로 import 해 쓴다 — 원본
// 산술의 중간값을 그대로 내는지가 여기서 처음 크게 시험된다. **화면을 만지는 것
// (tank_draw 0xF256, line_probe 0x46CA)과 Borland 런타임 소리(sound/nosound)는
// 아직 host 경계 뒤에 있다** — 골든이 인자를 잡고 선 탐침 반환값을 되먹인다. 그것들이
// 재구현 코드로서 서로 맞물리는 것은 2단계에서 풀 몫이다.
//
// ── 산술 세부 ────────────────────────────────────────────────────────────────
// disasm 의 `cwde`/`cdq` 는 실제로 `cbw`/`cwd` 다 (16비트 프로그램). 꼭짓점 회전의
// `imul dx`·`idiv bx=0x2EE` 는 16비트라, ox*cos 가 16비트를 넘으면 잘린 채로 나눈다
// — 그 잘림을 그대로 옮긴다 (imul16/idiv16). 32비트 곱셈·나눗셈(FLXMUL/FLXDIV)만
// lmul/sdiv 를 쓴다.

import { lmul, sdiv, u32 } from "./borland_long.js";
import { rand } from "./rand.js";
import { sine, cosine } from "./trig.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

/** 16비트 부호 있는 곱셈의 낮은 워드 (`imul dx`). */
const imul16 = (a        , b        )         => u16(i16(a) * i16(b));
/** 16비트 부호 있는 나눗셈의 몫, 0 쪽으로 자름 (`cwd; idiv bx`). */
const idiv16 = (a        , b        )         => i16(Math.trunc(i16(a) / i16(b)));

function dgw(dg            , off        )         {
  const o = u16(off);
  return dg[o] | (dg[u16(o + 1)] << 8);
}
function setw(dg            , off        , v        )       {
  const o = u16(off);
  dg[o] = v & 0xff;
  dg[u16(o + 1)] = (v >> 8) & 0xff;
}

// 탱크 레코드 필드 (bx = t * STRIDE 기준 오프셋)
const STRIDE = 0x176;
const SHAPE_IDX = 0x43fd;    // 부호 있는 바이트 — 꼭짓점 표 0x1251 의 행 색인
const POS_X = 0x4405;        // 32비트 (1/50 픽셀), lo 0x4405 / hi 0x4407
const POS_Y = 0x4409;        // 32비트, lo 0x4409 / hi 0x440b
const ANGLE = 0x440d;        // 워드
const FLASH_TIMER = 0x445e;  // 워드 — 0 이면 이 탱크는 안 깜빡인다
const STEP = 0x4460;         // 부호 있는 바이트 — 정방향 1..10, 역방향 -1..-40/-80
const RESPAWN_FLAG = 0x4461; // 바이트 — 정방향 끝에서 짝수 스테이지면 리스폰 여부를 가른다
const STAGE = 0x4462;        // 바이트 — 스테이지 카운터
const BASE_DH = 0x4463;      // 보간 시작 (부호 있는 바이트)
const BASE_CL = 0x4464;
const BASE_CH = 0x4465;
const TGT_DH = 0x4466;       // 보간 목표
const TGT_CL = 0x4467;
const TGT_CH = 0x4468;

// DGROUP 전역
const FLASH_SPEED = 0x4d63;       // 워드 — /14 가 깜빡임 한 걸음의 프레임 간격
const NTANKS = 0x4d73;            // 바이트
const RESPAWN_COUNTDOWN = 0x4d75; // 워드 — 루프 뒤 소리 시퀀스의 길이
const VIDEO_MODE = 0x4d79;        // 바이트 — 화면 크기 표 색인
const GEOM = 0x1241;             // 표, 걸음 4: +0 maxX, +2 maxY
const VTX_TABLE = 0x1251;        // 표, 걸음 6: 부호 있는 바이트 쌍 3개 (+0 x, +1 y)
const PAL_CACHE = 0x33ac;        // 표, 걸음 3: 슬롯별 팔레트 캐시 (R, ?, ?)
const PAL_SLOT = 0x126f;         // 탱크별 16색 슬롯 (바이트)

/** 그리기·탐침·소리·대기의 경계. 화면 상태를 재현하지 않고 판정하려면 여기 뒤에 둔다. */
                              
                                                               
                                                  
                                                          
                                                       
                                                                   
                                                                
                                                                        
                                               
                          
                         
                  
                                                   
                            
 

/** [+baseOff] + ((target - base) * step / 10) 의 낮은 바이트 (원본은 8비트 덧셈). */
function interp(dg            , b        , step        , tgtOff        , baseOff        )         {
  const tgt = sbyte(dg[u16(b + tgtOff)]);
  const base = sbyte(dg[u16(b + baseOff)]);
  const q = idiv16(imul16(u16(tgt - base), step), 10);
  return (dg[u16(b + baseOff)] + (q & 0xff)) & 0xff; // add al, dl
}

/** target 삼색을 팔레트 캐시 0x33AC[슬롯] 에서 되돌린다 (역방향 끝 / 리스폰 진입). */
function restoreTargetFromCache(dg            , t        , b        )       {
  const pb = imul16(sbyte(dg[u16(t + PAL_SLOT)]), 3);
  dg[u16(b + TGT_DH)] = dg[u16(pb + PAL_CACHE)];
  dg[u16(b + TGT_CH)] = dg[u16(pb + PAL_CACHE + 1)];
  dg[u16(b + TGT_CL)] = dg[u16(pb + PAL_CACHE + 2)];
}

/** 리스폰 자리를 뽑아 검사가 통과할 때까지 다시 뽑는다 (0x133D2~0x1363E). */
function respawnPlace(host             , dg            , t        , b        , slotByte        )       {
  host.eraseTank(t, 1);

  const gi = u16(sbyte(dg[VIDEO_MODE]) << 2);
  const maxX = dgw(dg, u16(gi + GEOM));
  const maxY = dgw(dg, u16(gi + GEOM + 2));

  for (;;) {
    // x, y 자리 — (rand() * (표값 - k) / 32768 + 20) * 50, 32비트로 저장
    placeAxis(dg, b, POS_X, u16(maxX - 80));
    placeAxis(dg, b, POS_Y, u16(maxY - 40));

    const angle = dgw(dg, u16(b + ANGLE));
    const shapeIdx = sbyte(dg[u16(b + SHAPE_IDX)]);
    const posX32 = dgw(dg, u16(b + POS_X)) | (dgw(dg, u16(b + POS_X + 2)) << 16);
    const posY32 = dgw(dg, u16(b + POS_Y)) | (dgw(dg, u16(b + POS_Y + 2)) << 16);
    const pxPix = u16(sdiv(u32(posX32), 50) & 0xffff); // FLXDIV 로 1/50 을 되돌림
    const pyPix = u16(sdiv(u32(posY32), 50) & 0xffff);

    const vx           = [0, 0, 0];
    const vy           = [0, 0, 0];
    for (let s = 0; i16(s) < 3; s = u16(s + 1)) {
      const vi = u16(imul16(shapeIdx, 6) + u16(s << 1));
      const ox = sbyte(dg[u16(vi + VTX_TABLE)]);
      const oy = sbyte(dg[u16(vi + VTX_TABLE + 1)]);
      const rotX = i16(idiv16(imul16(ox, cosine(angle)), 0x2ee) - idiv16(imul16(oy, sine(angle)), 0x2ee));
      const rotY = i16(idiv16(imul16(ox, sine(angle)), 0x2ee) + idiv16(imul16(oy, cosine(angle)), 0x2ee));
      vx[s] = u16(pxPix + rotX);
      vy[s] = u16(pyPix + rotY);
    }

    let allClear = 1;
    for (let s = 0; i16(s) < 3; s = u16(s + 1)) {
      const nx = s === 2 ? vx[0] : vx[s + 1];
      const ny = s === 2 ? vy[0] : vy[s + 1];
      const ret = host.probe(vx[s], vy[s], nx, ny, 3, 8, slotByte & 0xff, 0xf);
      if (i16(ret) !== -1) { allClear = 0; break; }
    }
    if (allClear !== 0) return;
  }
}

/** 한 축의 자리를 뽑아 [b+fieldLo] 에 32비트로 넣는다. limit = 표값 - k (k 는 부른 쪽이 뺐다). */
function placeAxis(dg            , b        , fieldLo        , limit        )       {
  const q = sdiv(lmul(u32(i16(limit)), u32(rand())), 32768);
  const v = i16(u16((q & 0xffff) + 0x14)); // add ax, 0x14; cwd
  const fixed = lmul(50, u32(v));
  setw(dg, u16(b + fieldLo), fixed & 0xffff);
  setw(dg, u16(b + fieldLo + 2), (fixed >>> 16) & 0xffff);
}

/** 원본 0x12FD5. dg 는 DGROUP 을 통째로 담은 64KiB 배열. 필드를 읽고 쓴다. */
export function tankColourFlashAndRespawn(host             , dg            )       {
  const ntanks = sbyte(dg[NTANKS]);

  for (let t = 0; i16(t) < i16(ntanks); t = u16(t + 1)) {
    const b = imul16(t, STRIDE);
    if (dgw(dg, u16(b + FLASH_TIMER)) === 0) continue;

    setw(dg, u16(b + FLASH_TIMER), u16(dgw(dg, u16(b + FLASH_TIMER)) + 1));
    const timer = dgw(dg, u16(b + FLASH_TIMER));
    const speed = idiv16(dgw(dg, FLASH_SPEED), 14);
    if (i16(timer) % i16(speed) !== 0) continue;

    let step = sbyte(dg[u16(b + STEP)]);
    step = sbyte(i16(step) < 0 ? step - 1 : step + 1);
    dg[u16(b + STEP)] = step & 0xff;
    const di = sbyte(step);

    if (i16(di) < 0) {
      // 역방향 다리 — 색을 안 건드리고 끝점만 본다
      const stage = dg[u16(b + STAGE)] & 0xff;
      const endpoint = i16(u16(0xffd8 - imul16(stage === 3 ? 1 : 0, 0x28)));
      if (endpoint !== i16(di)) continue;
      dg[u16(b + STAGE)] = (stage + 1) & 0xff;
      dg[u16(b + STEP)] = 0;
      setw(dg, u16(b + FLASH_TIMER), 1);
      restoreTargetFromCache(dg, t, b);
      continue;
    }

    // 정방향 다리 — 보간해서 DAC 에 쓴다
    const dh = interp(dg, b, di, TGT_DH, BASE_DH);
    const ch = interp(dg, b, di, TGT_CH, BASE_CH);
    const cl = interp(dg, b, di, TGT_CL, BASE_CL);
    const slotByte = dg[u16(t + PAL_SLOT)];
    const reg = u16(i16(sbyte(slotByte)) + (i16(sbyte(slotByte)) > 7 ? 0x30 : 0));
    host.setDacRegister(reg, dh, ch, cl);

    if (di !== 0xa) continue;

    // 정방향 끝 (스텝 10) — base←target 넣고 다음을 가른다
    dg[u16(b + STEP)] = 0;
    dg[u16(b + BASE_DH)] = dg[u16(b + TGT_DH)];
    dg[u16(b + BASE_CH)] = dg[u16(b + TGT_CH)];
    dg[u16(b + BASE_CL)] = dg[u16(b + TGT_CL)];

    const respawnFlag = dg[u16(b + RESPAWN_FLAG)] & 0xff;
    const oddStage = i16(sbyte(dg[u16(b + STAGE)])) % 2 !== 0;

    if (respawnFlag === 0 && !oddStage) {
      setw(dg, u16(b + FLASH_TIMER), 0);
      dg[u16(b + STAGE)] = 0;
      continue;
    }
    if (oddStage) {
      setw(dg, u16(b + FLASH_TIMER), 1);
      dg[u16(b + STEP)] = 0xff; // -1 → 역방향 시작
      continue;
    }
    // respawnFlag != 0, 짝수 스테이지 → 리스폰
    setw(dg, u16(b + FLASH_TIMER), 1);
    restoreTargetFromCache(dg, t, b);
    dg[u16(b + RESPAWN_FLAG)] = 0;
    respawnPlace(host, dg, t, b, slotByte);
  }

  // ── 루프 뒤 소리 시퀀스 ────────────────────────────────────────────────
  if (dgw(dg, RESPAWN_COUNTDOWN) !== 0) {
    const iters = idiv16(dgw(dg, RESPAWN_COUNTDOWN), 8);
    for (let i = 0; i16(iters) >= i16(i); i = u16(i + 1)) {
      host.sound(u16(0x1f4 - imul16(i, 0xa)));
      host.wait(u16((sdiv(lmul(7, u32(rand())), 32768) & 0xffff) + 4));
      host.nosound();
    }
    setw(dg, RESPAWN_COUNTDOWN, idiv16(dgw(dg, RESPAWN_COUNTDOWN), 5));
  }
}
