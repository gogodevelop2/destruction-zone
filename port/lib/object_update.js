// 원본 DZONE.EXE 의 날아다니는 객체 갱신·피해·점수·격추 0x0F3CA 재구현.
//
// 메인 게임 루프 0x0AC29 가 프레임마다 한 번 부른다 (0x0AC72). 살아 있는 날아다니는
// 객체를 하나씩 훑으면서 각각을 한 프레임만큼 나아가게 하고, 화면을 탐침해 부딪힘을
// 판정하고, 피해와 점수와 격추와 폭발을 처리한다. 점프 표도 간접 분기도 포트 0x60
// 직접 읽기도 없다. 되돌아가는 분기 10개, 범위 0x0F3CA..0x1061B, 명령 약 2,000개.
//
// 바이트 근거는 disasm/addr_0x0F3CA.md. 여러 함수가 공유하는 사실(탱크 레코드 필드,
// 표식 레코드, 카탈로그, 색 표 두 개)은 analysis/damage_and_scoring.md 에 있고 거기
// 술어가 붙는다. 이 함수 하나가 무슨 일을 하는지는 여기 주석이 담는다.
//
// ── 파일이 따로인 이유 ──────────────────────────────────────────────────────
// 이 함수는 weapon.ts 의 runFire(0x1077D)를 부르는데 weapon.ts 는 objects.ts 를
// import 한다. updateObjects 를 objects.ts 에 두면 objects.ts → weapon.ts →
// objects.ts 순환 import 가 된다. 새 파일은 objects.ts 와 weapon.ts 를 둘 다 import
// 하고 어느 쪽에서도 import 되지 않는 위층에 있다.
//
// ── 좌표 공간 ───────────────────────────────────────────────────────────────
// 위치는 1/50 픽셀 단위의 부호 있는 32비트다. 각은 1/50 도 단위이고 0..17999 로
// 유지한다 (18000 = 0x4650 으로 나눈 나머지). 화면에 넘길 때는 전부 borland 0x11D6
// 으로 50 을 나눈다 (sdiv(값, 50), 하위 워드만 쓴다).
//
// ── 객체 레코드 (base 0x343C + i*32, ObjectArray 접근자로) ──────────────────
//   +0x00 i32  직전 프레임 X. 지워야 할 선분의 한 끝
//   +0x04 i32  직전 프레임 Y
//   +0x08 i32  현재 X
//   +0x0C i32  현재 Y
//   +0x10 i16  진행 방향 (1/50 도)
//   +0x12 i16  기준 속도
//   +0x14 i16  현재 속도
//   +0x16 i16  피해량
//   +0x18 i16  운반체 표시. 0 이 아니면 소멸할 때 소유자에 대해 runFire 를 부르고
//              객체를 안 지운다
//   +0x1A i16  유도 카운트다운
//   +0x1C i16  진행 방향을 흔드는 두 번째 카운트다운
//   +0x1E u8   소유한 탱크 번호 (6 이면 임자 없음)
//   +0x1F u8   수명 카운트다운. 0 이 되면 객체가 소멸한다
//
// ── 탱크 레코드 (base 0x43FC + t*0x176, dg 절대 오프셋으로) ─────────────────
//   +0x02 u8   파괴됨 플래그 (0x43FE)
//   +0x03 u8   편 번호 (0x43FF)
//   +0x09 i32  X (0x4405)          +0x0D i32  Y (0x4409)
//   +0x21 u8   갑옷 등급. 피해를 이것으로 나눈다. 폭발 고리 간격도 이것으로 (0x441D)
//   +0x22 i16  실드. 피해를 여기서 뺀다. 0 이하가 되면 파괴 (0x441E)
//   +0x26 u8   무기 에너지. 파괴 때 0 으로 (0x4422)
//   +0x28 i32  점수/크레딧. 피해 준 만큼 더한다(같은 편이면 뺀다). 격추 보너스 30 (0x4424)
//   +0x30 i32  누적 피해 총량. 같은 편 오사는 안 건드린다 (0x442C)
//   +0x34 u8   고른 무기 슬롯 (0x4430)
//   +0x3B u8   0 이 아니면 이 탱크가 주는 피해에 5/3 을 곱한다 (0x4437)
//   +0x3F u8   폭발 고리 수의 바탕. 바깥 루프가 2*이 값 까지 돈다 (0x443B)
//   +0x41 u8[3] 삼각형 세 꼭짓점의 X 오프셋, di 로 색인 (0x443D)
//   +0x43 u8   삼각형 꼭대기 X 오프셋 (0x443F)
//   +0x45 u8[3] 삼각형 세 꼭짓점의 Y 오프셋, di 로 색인 (0x4441)
//   +0x47 u8   삼각형 꼭대기 Y 오프셋 (0x4443)
//   +0x49 u8[8] 재고 배열, 무기 슬롯으로 색인. 값은 카탈로그 레코드 번호 (0x4445)
//   +0x66 u8   0 이 아니면 점멸 중 — 이 탱크가 받는 피해를 0 으로 (0x4462)
//   +0x15A i32[] 탱크별 피해 표, (맞은쪽*4) 로 색인 (0x4556)
//   +0x172 i16  격추 수. 파괴 때 소유자 쪽을 올린다 (0x456E)
//   +0x174 i16  죽은 수. 파괴 때 맞은쪽을 올린다 (0x4570)
//
// ── 표식 레코드 (base 0x33DC + team*0x20, team 은 1 또는 2. markers.ts 와 같다) ──
//   +0x16 i16  그 편의 에너지. 도는 빠르기로 보인다. 0 이 되면 라운드 끝 (0x33F2+team*0x20)
//   +0x18 i32  상대 편으로 옮겨 간 에너지 누적 (0x33F4+team*0x20)
//
// ── 표 ─────────────────────────────────────────────────────────────────────
//   카탈로그    base 0x5DC, 보폭 0x3D.  +0x38 (0x614) = 동작 식별자. 19 면 "confusor"
//   기량 표     base 0x4CC0, 보폭 0x15. +0x00 = 기량 등급 (1..5)
//   팔레트 슬롯  0x126F[t]  탱크 t 의 색
//   색→소유자   0x127E[c]  색 c 가 어느 탱크인가. 음수면 팀 표식 (-1, -2), 색인 4·5 에
//
// ── 스칼라 (dg 절대) ───────────────────────────────────────────────────────
//   읽기: 0x4D63 M(적응형 타임스텝 상수)  0x4D65 팀 모드 플래그  0x4D6F M 재계산 분자
//         0x4D71 객체 수  0x4D72 살아 있는 탱크 수  0x4D73 탱크 수
//         0x4D75 소리 모드 2 피해 누적  0x4D78 소리 모드
//   쓰기: 0x4D62 팀 전멸 결과(1/2/3)  0x4D63 M 재계산(20 아래로 안 내려감)
//         0x4D66 라운드 끝 플래그  0x4D71 객체 수--(지울 때)
//         0x4D72 탱크 수--(파괴 때)  0x4D75 += 피해(소리 모드 2, 두 자리)
//
// ── 구조: 바깥 루프 하나 + 객체마다 순차 단계 여덟 ─────────────────────────
//   0. sampleKeyboard 한 번 (객체마다 — 프레임마다가 아니다)
//   1. 유도 조향       문 obj.+0x1A ∈ {1,2}. 탱크 훑어 최근접 표적, 각차 접기,
//                      속도 감소, heading 을 20000/[0x4D63] 만큼 회전
//   2. 두 번째 카운트다운  문 obj.+0x1C. % ([0x4D63]/12) == 0 이면 heading 흔들기
//   3. 움직임           new = cur + trig(heading)*speed/[0x4D63], setcolor(8)+line 으로
//                      직전 선분 지우기
//   4. 탐침 #1          probe(count 3, c1 8, c2 15, c3 ownerColour) → hit 색
//   5. 억지 결과        newX < 0 또는 newY < 0 → hit 7 ; obj.+0x1F 카운트다운(rand
//                      게이트) 0 도달 → hit 7
//   6. 색 하나로 네 갈래:
//        A hit 0xFF        → 새 선분 그리기, 위치 굴리기
//        B hit 7/0         → obj.+0x18 켜졌으면 runFire(owner) 실행·객체 유지,
//                            아니면 제거(압축·색인 되돌림·[0x4D63] 재계산)
//        C 0x127E[hit] < 0 → 표식 맞음: 에너지를 진 편에서 이긴 편으로, 라운드끝 플래그
//        D 0x127E[hit] >= 0 → 탱크 맞음: 섬광 삼각형 → 탐침 #2 → drawTank → 피해 적용
//                            → 실드 0 이하면 파괴(격추 보너스·카운터·drawStatusPanel·
//                            tankMove(1)·폭발 이중 루프·drawTank·팀 전멸 셈)
//   7. 수렴점 0x10212 + 루프 끝
//
// spawnObject 와 runFire 는 retf 로 안 막고 실제로 돌린다 — 배열을 늘리고, 그 늘어난
// 객체를 뒤이은 반복이 훑는다. 작업 33 의 근거와 같다.
//
// ── 판정 밖 (blindSpots) ──────────────────────────────────────────────────
// · 픽셀. BGI setcolor/line/moveto/lineto 는 인자만 대조한다 (1단계 경계).
// · 탐침 0x046CA 가 화면에서 읽는 색 열. 반환값은 host 로 받아 대본에서 재생하고
//   인자만 대조한다 (작업 30·33 방식). 0x046CA 자체는 line_probe_vectors_v1 이 판정한다.
// · 키 링 (0x4D8x/0x4D9x). 0x0F3CA 는 이 자리를 한 번도 안 읽는다 (감독이 grep 확인,
//   0건). sampleKeyboard 를 부른 횟수만 대조하고 링 바이트는 안 본다. 포트 0x60 은
//   하드웨어라 비결정적 — keyboard.ts 가 이미 밝힌 그 사각이다. 이 함수의 판정은
//   0x0AEB8 의 미완성에 안 매인다.
// · 0x0E128 tankMove(1) (파괴 경로, 0x10018). tank_move.ts 가 위치·각 적분 조각만
//   옮겼다. 여기서는 host 껍데기로 받아 "불렀다 + kind 인자" 만 대조한다. 캡처에서
//   0x0E128 을 retf 로 막는다. 즉 파괴 경로 판정은 0x0E128(1) 이 하는 일을 뺀 것이다.
//   3단계가 파괴 경로 hold-out 으로 이 자리를 잰다.
// · 소리 0x02914/0x02940. 하드웨어(8253 타이머 + 포트 0x61). 호출 + hz 인자만 대조,
//   캡처에서 retf. [0x4D78] == 1 일 때만 도는 자리 — 3단계 hold-out 이 통제값을 심는다.
//
// @원본 0x0F3CA

import { ObjectArray, spawnObject } from "./objects.js";
import { runFire,               } from "./weapon.js";
import { sine, cosine } from "./trig.js";
import { angle as angleBetween } from "./angle.js";
import { sdiv, lmul, i32, u32 } from "./borland_long.js";
import { randStep } from "./rand.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;
/** 16비트 부호 있는 곱의 하위 16비트 (`imul dx` 다음 `mov bx,ax`). */
const imul16 = (a        , b        )         => u16(i16(a) * i16(b));
/** 16비트 `idiv bx` 의 제수가 0 이면 원본은 나눗셈 예외(INT 0)로 죽는다 — borland
 *  런타임이 받아 프로그램을 끝내므로 "그때 나오는 값" 이 없다. borland_long 과 같은
 *  계약으로 던진다 (조용히 0 을 내면 원본이 죽는 자리를 지나쳐 버린다). */
function idivGuard(den        )       {
  if ((den & 0xffff) === 0)
    throw new Error("object_update: 16비트 0 으로 나눔 — 원본은 INT 0 로 죽는다");
}
/** 16비트 부호 나눗셈(`cwd; idiv bx`)의 몫. 0 쪽으로 자르고 부호를 유지한다. */
const idivq = (num        , den        )         => { idivGuard(den); return i16(Math.trunc(i16(num) / i16(den))); };
/** 같은 나눗셈의 나머지. 부호는 피제수를 따른다. */
const idivr = (num        , den        )         => { idivGuard(den); return i16(i16(num) % i16(den)); };
/** sdiv 의 하위 워드 (원본이 `push ax` 로 몫의 하위 워드만 쓰는 자리). */
const sd16 = (a        , b        )         => i16(sdiv(i32(a), i32(b)));

const OBJ_BASE = 0x343c;
const TANK_BASE = 0x43fc, TANK_STRIDE = 0x176;
const MARK_BASE = 0x33dc, MARK_STRIDE = 0x20;   // markers.ts 와 같다
const CAT_BASE = 0x5dc, CAT_STRIDE = 0x3d;      // +0x38 = 동작 식별자
const SKILL_BASE = 0x4cc0, SKILL_STRIDE = 0x15; // +0x00 = 기량 등급
const SLOT_COLOUR = 0x126f;                     // 팔레트 슬롯 표
const COLOUR_OWNER = 0x127e;                    // 색 → 소유자/표식

const S_TEAMWIPE = 0x4d62, S_M = 0x4d63, S_TEAM = 0x4d65, S_ROUNDOVER = 0x4d66;
const S_MNUM = 0x4d6f, S_OBJCOUNT = 0x4d71, S_LIVETANKS = 0x4d72, S_TANKS = 0x4d73;
const S_SNDACC = 0x4d75, S_SNDMODE = 0x4d78;

/** 원본이 BGI·소리·탱크 그리기·상태창·탐침·키보드에 맡기는 것들. 1단계 경계이므로
 *  전부 인자만 받는다 (probe 만 반환값을 준다 — 대본에서 재생). */
                                                    
                                                                  
                     
                         
                            
                                     
                            
                                     
                                                        
                          
                  
                                                                         
                                             
                                                                                            
                                                                  
                                                       
                               
 

/**
 * 원본 0x0F3CA 한 프레임. 살아 있는 날아다니는 객체를 전부 갱신한다.
 *
 * @param host  BGI·소리·탱크 그리기·상태창·탐침·키보드를 받을 곳
 * @param dg    호출자가 주는 64KiB DGROUP. 탱크 레코드·표식·카탈로그·스칼라가 여기 있다
 * @param arr   날아다니는 객체 배열 (DGROUP 0x343C, 개수 0x4D71). dg 위에 얹혀 있다
 *
 * @param frameBp 이 호출의 BP (게임 루프에서 0xFFE2). 주면 두 line 자리에서 BGI line 0x15CB1 의 push bp 가 남기는
 *              워드를 DGROUP 에 쓴다. sub sp,0x18 + si·di 에 인자 넷과 far 복귀 주소를 쌓으면 line 이 BP 를 저장하는
 *              자리가 [bp-0x2A] 이고 값은 이 BP 다. 오토파일럿이 초기화하지 않고 읽는 칸과 겹친다 (devlog 120·122).
 *
 * 반환값 없음 (원본 retf, 부르는 0x0AC72 가 AL 을 버린다).
 */
export function updateObjects(host                  , dg            , arr             , frameBp         )       {
  const dv = new DataView(dg.buffer, dg.byteOffset, dg.byteLength);
  const lineResidue = ()       => { if (frameBp !== undefined) dv.setUint16((frameBp - 0x2a) & 0xffff, frameBp & 0xffff, true); };

  // ── 절대 주소 DGROUP 접근 ─────────────────────────────────────────────────
  const A8 = (off        )         => dg[off & 0xffff];
  const wA8 = (off        , v        )       => { dg[off & 0xffff] = v & 0xff; };
  const AI8 = (off        )         => sbyte(dg[off & 0xffff]);
  const A16 = (off        )         => dv.getUint16(off & 0xffff, true);
  const AI16 = (off        )         => dv.getInt16(off & 0xffff, true);
  const wA16 = (off        , v        )       => dv.setUint16(off & 0xffff, v & 0xffff, true);
  const AI32 = (off        )         => dv.getInt32(off & 0xffff, true);
  const wA32 = (off        , v        )       => dv.setInt32(off & 0xffff, v | 0, true);
  /** 두 워드를 이어 붙인 32비트 (원본은 `mov ax,[hi]; mov dx,[lo]` 로 읽는다). */
  const A32 = (loOff        )         =>
    (dv.getUint16((loOff + 2) & 0xffff, true) << 16 | dv.getUint16(loOff & 0xffff, true)) | 0;

  // ── 탱크 레코드 접근. base = TANK_BASE + t*0x176, 경계 검사 없이. ──────────
  const tRec = (t        )         => (TANK_BASE + imul16(sbyte(t), TANK_STRIDE)) & 0xffff;
  // ── 표식 레코드. base = MARK_BASE + team*0x20 (team 1 또는 2). ────────────
  const mRec = (team        )         => (MARK_BASE + (u16(team) << 5)) & 0xffff;

  // ── rand 씨앗. 원본 DGROUP 0x3268(lo)/0x326A(hi) 의 32비트 하나. ──────────
  let seed = ((A16(0x326a) << 16) | A16(0x3268)) >>> 0;
  let seedTouched = false;
  const draw = ()         => {
    const r = randStep(seed);
    seed = r.next;
    seedTouched = true;
    return r.result;                                 // 0..32767
  };
  const flushSeed = ()       => {
    if (!seedTouched) return;
    wA16(0x3268, seed & 0xffff);
    wA16(0x326a, (seed >>> 16) & 0xffff);
  };

  // ── 객체 배열 접근. arr(ObjectArray)가 같은 dg 를 감싼다. i16/i32/u8 접근자는
  //    ObjectArray 가 이미 준다 (0x343C + i*32 + off, 16비트로 접힌다). ────────
  // (아래 본문에서 arr.i16 / arr.i32 / arr.u8 / arr.wI16 / arr.wI32 / arr.wU8 를 쓴다.)

  // ═══ 바깥 루프 (0x0F3D2..0x10613). [bp-1] = 객체 색인, 제거 때 손으로 되돌린다. ═══
  let i = 0;
  while ((i & 0xff) < (arr.count & 0xff)) {         // 0x1060A cmp al,[0x4D71]; jae 나감
    // ── 단계 0 — 키보드 표본 (0x0F3DA). 객체 하나마다 한 번. 이 함수는 반환값도
    //    부작용(키 링)도 안 읽는다 — 부른 횟수만 관측된다. ────────────────────
    host.sampleKeyboard();

    // 단계 3·4·5 가 채우는 새 위치와 hit 색. 단계 6 이 읽는다.
    let newX = 0, newY = 0;
    let hit = 0;                                    // [bp-5] — hit 색 (0xFF/7/0/실제 색)

    // ═══ 단계 1 — 유도 조향 (0x0F3F1..0x0F700). 문 = obj.+0x1A ∈ {1,2}. ══════
    guide: {
      const g1a = i16(arr.i16(i, 0x1a));
      if (g1a === 0) break guide;                   // 0x0F3EC — 유도 안 함
      if (g1a !== 1 && g1a !== 2) {                 // 0x0F413 — 그 밖의 값이면 2 빼고 건너뜀
        arr.wI16(i, 0x1a, i16(g1a - 2));            // 0x0F6FC
        break guide;
      }

      // 탱크를 훑어 가장 가까운 표적을 고른다.
      let best = 0x7d00;                            // [bp-0x10] 초깃값 32000
      let target = -1;                              // [bp-5]
      const owner = arr.u8(i, 0x1e);
      for (let t = 0; sbyte(t) < AI8(S_TANKS); t = (t + 1) & 0xff) {  // 0x0F530
        if (A8(tRec(t) + 0x02) !== 0) continue;     // 0x0F42D — 파괴된 탱크는 표적 아님
        if (owner === t) continue;                  // 0x0F442 — 소유자는 절대 안 노림
        const slot = sbyte(A8(tRec(t) + 0x34));     // 0x0F45C — tank[t].+0x34, 부호 확장
        const w = sbyte(A8((tRec(t) + slot + 0x49) & 0xffff));  // 0x0F464 — +0x49[slot], 부호 확장
        const catBehav = A8((CAT_BASE + imul16(w, CAT_STRIDE) + 0x38) & 0xffff);  // 0x0F470
        if (catBehav === 0x13) continue;            // "confusor" — 유도를 흩는다

        // 거리 = (Δx/300)² + (Δy/300)² 의 하위 16비트 합. 곱은 32비트, 더하기는 16비트.
        const dxr = sdiv(i32(A32(tRec(t) + 0x09) - arr.i32(i, 0x00)), 300);   // 0x0F4AA
        const dyr = sdiv(i32(A32(tRec(t) + 0x0d) - arr.i32(i, 0x04)), 300);   // 0x0F4E5
        const d = i16((lmul(dxr, dxr) & 0xffff) + (lmul(dyr, dyr) & 0xffff)); // 0x0F513
        if (i16(d) < i16(best)) { best = d; target = t; }                     // 0x0F519 jge → 건너뜀
      }

      if (best === 0x7d00) break guide;             // 0x0F53C — 표적이 없다

      // 표적을 찾았다. heading·표적 각·오차를 구하고 방향을 돌린다.
      const heading = idivq(arr.i16(i, 0x10), 50);  // 0x0F546 — 도 단위
      const angleToTarget = angleBetween(           // 0x0F5DD — 인자 넷: 객체 직전 X/Y, 표적 X/Y (전부 /50)
        sd16(arr.i32(i, 0x00), 50), sd16(arr.i32(i, 0x04), 50),
        sd16(A32(tRec(target) + 0x09), 50), sd16(A32(tRec(target) + 0x0d), 50),
      );
      let sign = angleToTarget <= heading ? -1 : 1;         // 0x0F5E6 jle → -1
      let err = i16(Math.abs(i16(angleToTarget - heading))); // 0x0F5FA..0x0F613
      if (err >= 0xb4) { sign = -sign; err = i16(0x168 - err); }  // 0x0F616 — 180 이상이면 짧은 쪽으로 접는다

      if (i16(arr.i16(i, 0x12)) > 0x19) {           // 0x0F638 — 기준 속도 > 25 면 현재 속도를 줄인다
        arr.wI16(i, 0x14, idivq(imul16(arr.i16(i, 0x12), i16(0xb8 - err)), 0xb8));  // 0x0F649
      }

      // 방향을 20000/[0x4D63] 만큼 오차 쪽으로 돌린다. 이 나눗셈이 적응형 타임스텝이
      // 실제 회전량에 작용하는 자리다 — 포트가 프레임 속도를 고정으로 잡아도 재현한다.
      const nudge = imul16(idivq(0x4e20, i16(A16(S_M))), sign);   // 0x0F67A
      const h = i16(i16(arr.i16(i, 0x10)) + nudge);              // 0x0F688
      arr.wI16(i, 0x10, idivr(h, 0x4650));                       // 0x0F68A..0x0F69A — % 18000
      if (i16(arr.i16(i, 0x10)) < 0) arr.wI16(i, 0x10, i16(arr.i16(i, 0x10) + 0x4650));  // 0x0F6A8

      // obj.+0x1A 를 다음 값으로: 1 → 11 (10 더함), 2 → 4 (2 더함).
      const add1a = ((i16(arr.i16(i, 0x1a)) === 1 ? 1 : 0) << 3) + 2;  // 0x0F6C9..0x0F6DD
      arr.wI16(i, 0x1a, i16(arr.i16(i, 0x1a) + add1a));                // 0x0F6EC
    }

    // ═══ 단계 2 — 두 번째 카운트다운 (0x0F701..0x0F779). 문 = obj.+0x1C. ══════
    if (arr.i16(i, 0x1c) !== 0) {                   // 0x0F70B
      arr.wI16(i, 0x1c, i16(arr.i16(i, 0x1c) - 1)); // 0x0F71C dec
      const divi = idivq(A16(S_M), 0xc);            // 0x0F72F — [0x4D63] / 12
      if (idivr(arr.i16(i, 0x1c), divi) === 0) {    // 0x0F73E or dx,dx; jne 0xf77a
        // 방향을 남은 값의 두 배만큼 돌린다.
        arr.wI16(i, 0x10, idivr(i16(i16(arr.i16(i, 0x10)) + i16(arr.i16(i, 0x1c) * 2)), 0x4650));  // 0x0F742..0x0F776
      }
    }

    // ═══ 단계 3 — 움직임 + 직전 선분 지우기 (0x0F77A..0x0F833). ═══════════════
    // new = cur + trig(heading)*속도/[0x4D63]. cosine/sine 결과와 속도를 32비트로
    // 부호 확장한 뒤 flxmul(32비트 곱), 그다음 [0x4D63] 으로 나눈다.
    {
      const head = i16(arr.i16(i, 0x10));
      const spd = u32(i16(arr.i16(i, 0x14)));
      const cosTerm = sdiv(i32(lmul(u32(i16(cosine(head))), spd)), i16(A16(S_M)));  // 0x0F7A8..0x0F7AF
      newX = i32(arr.i32(i, 0x08) + cosTerm);                                        // 0x0F7C8 add/adc
      const sinTerm = sdiv(i32(lmul(u32(i16(sine(head))), spd)), i16(A16(S_M)));     // 0x0F800..0x0F807
      newY = i32(arr.i32(i, 0x0c) + sinTerm);                                        // 0x0F820 add/adc
    }
    // 지우기: 바닥색으로 직전 선분을 덧그린다. line(직전 X/Y, 현재 X/Y).
    host.setColor(8);                                                                // 0x0F82E
    host.line(sd16(arr.i32(i, 0x00), 50), sd16(arr.i32(i, 0x04), 50),
              sd16(arr.i32(i, 0x08), 50), sd16(arr.i32(i, 0x0c), 50));               // 0x0F8B0
    lineResidue();

    // ═══ 단계 4 — 부딪힘 탐침 #1 (0x0F8B8..0x0F944). ═════════════════════════
    const ownerColour = A8((SLOT_COLOUR + sbyte(arr.u8(i, 0x1e))) & 0xffff);         // 0x0F8C2
    hit = host.probe({                                                               // 0x0F93C
      x1: sd16(arr.i32(i, 0x08), 50), y1: sd16(arr.i32(i, 0x0c), 50),
      x2: sd16(newX, 50), y2: sd16(newY, 50),
      count: 3, c1: 8, c2: 15, c3: ownerColour,
    }) & 0xff;                                                                       // 0x0F942 [bp-5] = al

    // ═══ 단계 5 — 억지 결과 덮어쓰기 (0x0F945..0x0F9C3). ════════════════════
    // 왼쪽·아래 경계만 본다 (오른쪽·위는 탐침이 테두리를 읽어서 잡는다).
    // 원본 0x0F94D 의 `jb` 갈래는 죽은 코드다 (`cmp _,0` 뒤 carry 는 늘 0).
    if ((newX | 0) < 0 || (newY | 0) < 0) hit = 7;                                   // 0x0F945..0x0F961
    if (arr.u8(i, 0x1f) !== 0) {                                                     // 0x0F96F
      const r = draw();                                                              // 0x0F97D rand()
      const gate = sdiv(i32(lmul(u32(r), u32(idivq(A16(S_M), 2)))), 0x8000);         // 0x0F991..0x0F998
      if ((gate & 0xffff) === 0) {                                                   // 0x0F99D or ax,ax
        arr.wU8(i, 0x1f, (arr.u8(i, 0x1f) - 1) & 0xff);                              // 0x0F9AB dec
        if (arr.u8(i, 0x1f) === 0) hit = 7;                                          // 0x0F9C0
      }
    }

    // ═══ 단계 6 — 색 하나로 갈리는 네 갈래 (0x0F9C4..). ════════════════════
    //
    // 갈래 A (0x10502)  새 선분 그리기.        hit == 0xFF
    // 갈래 B (0x1022D)  운반체 아니면 제거.    hit == 7 또는 hit == 0, 그리고 수렴점에서도 옴
    // 갈래 C (0x0FA14)  표식 맞음.
    // 갈래 D (0x0FB73)  탱크 맞음 → 피해 → 파괴 → 폭발.
    //
    // 표식(C)·탱크(D) 갈래는 여러 자리에서 수렴점 0x10212 로 뛴다. 여기서는 그 자리에서
    // 블록을 벗어나 아래 수렴 코드로 떨어진다 (C 는 그냥 끝나고, D 는 dArm 레이블을 벗어난다).

    // 갈래 A — 새 선분 그리기 (0x10502..0x10606).
    const armA = ()       => {
      const oc = A8((SLOT_COLOUR + sbyte(arr.u8(i, 0x1e))) & 0xffff);  // 0x10513
      host.setColor(oc);                                               // 0x10519
      host.line(sd16(arr.i32(i, 0x08), 50), sd16(arr.i32(i, 0x0c), 50),
                sd16(newX, 50), sd16(newY, 50));                       // 0x10583 — 현재 → 새 위치
      lineResidue();
      arr.wI32(i, 0x00, arr.i32(i, 0x08));                             // 0x1058B — 직전 := 현재
      arr.wI32(i, 0x04, arr.i32(i, 0x0c));
      arr.wI32(i, 0x08, newX);                                         // 0x105D7 — 현재 := 새 위치
      arr.wI32(i, 0x0c, newY);
    };

    // [0x4D63] 재계산 (제거 경로 0x104CE, 발사 함수 꼬리와 같은 식).
    const recomputeM = ()       => {
      let bx = i16(sbyte(A8(S_LIVETANKS)) * 2);                        // 0x104CE..0x104D2
      bx = i16(bx + sbyte(A8(S_TEAM)));                                // 0x104DA
      bx = i16(bx + idivq(A8(S_OBJCOUNT) & 0xff, 4));                  // 0x104E5 — ah=0 이라 부호 없는 바이트
      wA16(S_M, idivq(A16(S_MNUM), bx) & 0xffff);                      // 0x104ED
      if (!(i16(A16(S_M)) >= 0x14)) wA16(S_M, 0x14);                   // 0x104F2 — 20 아래로 안 내려감
    };

    // 갈래 B — 운반체 아니면 제거 (0x1022D..0x10501).
    const armB = ()       => {
      if (arr.i16(i, 0x18) !== 0) {                                    // 0x1022D — 운반체
        // 소멸할 때 소유자에 대해 runFire 를 부르고 객체를 안 지운다. runFire 는 씨앗을
        // dg 에서 읽고 되쓰므로, 우리 지역 씨앗을 먼저 flush 하고 뒤에 다시 읽는다.
        flushSeed();
        runFire(host, dg, arr, sbyte(arr.u8(i, 0x1e)));                // 0x1024F
        seed = ((A16(0x326a) << 16) | A16(0x3268)) >>> 0;
        seedTouched = false;
        return;                                                        // 0x10253 jmp 0x10607 — 객체 유지
      }
      // 제거: 객체가 소유자 근처 20 안에서 죽었으면 소유자 탱크를 다시 그린다.
      const owner = arr.u8(i, 0x1e);
      const dxr = i16(sdiv(i32(A32(tRec(owner) + 0x09) - arr.i32(i, 0x08)), 300));  // 0x10291
      const dyr = i16(sdiv(i32(A32(tRec(owner) + 0x0d) - arr.i32(i, 0x0c)), 300));  // 0x102D4
      const d = i16(imul16(dxr, dxr) + imul16(dyr, dyr));                            // 0x102DC
      if (!(i16(d) >= 0x14)) host.drawTank(sbyte(owner), 0);                         // 0x102EC jge → 건너뜀

      wA8(S_OBJCOUNT, (A8(S_OBJCOUNT) - 1) & 0xff);                    // 0x10309 dec byte [0x4D71]
      // 뒤 레코드를 한 칸씩 당긴다 (필드별 복사 = 32바이트 통째 시프트 다운 = copyWithin).
      const cnt = A8(S_OBJCOUNT) & 0xff;                              // 이미 줄인 개수
      dg.copyWithin(
        (OBJ_BASE + i * 32) & 0xffff,
        (OBJ_BASE + (i + 1) * 32) & 0xffff,
        (OBJ_BASE + (cnt + 1) * 32) & 0xffff,
      );                                                              // 0x10316..0x104C8
      i = (i - 1) & 0xff;                                             // 0x104CB dec [bp-1] — 같은 자리를 다시 본다
      recomputeM();                                                   // 0x104CE
    };

    // ── 갈래 진입 (0x0F9C4). ──────────────────────────────────────────────
    if (hit === 0xff) {
      armA();                                                         // 0x0F9CA jmp 0x10502
    } else if (hit === 7 || hit === 0) {
      armB();                                                         // 0x0F9D3 / 0x0F9DC jmp 0x1021E → 0x1022D
    } else {
      const ownerOrMarker = sbyte(A8((COLOUR_OWNER + hit) & 0xffff)); // 0x0F9E9 [bp-6]
      const isColour3 = hit === 3;                                    // 0x0F9F0 [bp-0x17]

      if (ownerOrMarker < 0 && !isColour3) {
        // ── 갈래 C — 표식 맞음 (0x0FA14..0x0FB72). ─────────────────────────
        const owner = arr.u8(i, 0x1e);
        hit = owner;                                                  // 0x0FA14 [bp-5] = obj.+0x1E (수렴에서 덮인다)
        const team = -ownerOrMarker;                                  // 0x0FA25 neg → 1 또는 2
        let si = i16(arr.i16(i, 0x16) * 2);                           // 0x0FA2D — 피해 * 2
        if (A8(tRec(owner) + 0x3b) !== 0) si = idivq(imul16(si, 5), 3);        // 0x0FA51 — +0x3B 이면 5/3
        if (A8(S_SNDMODE) === 1) {                                    // 0x0FA60
          for (let cnt = 0; i16(idivq(si, 2)) > cnt; cnt++) {         // 0x0FA87 — si/2 번
            host.sound(u16(imul16(si, 0x32) + 0x64));                 // 0x0FA79
            host.nosound();                                           // 0x0FA7F
          }
        }
        if (A8(S_SNDMODE) === 2) wA16(S_SNDACC, u16(A16(S_SNDACC) + si));      // 0x0FA9B
        const skO = sbyte(A8((SKILL_BASE + imul16(owner, SKILL_STRIDE)) & 0xffff)); // 0x0FA9F
        if (skO > 1) si = i16(si + idivq(imul16(skO - 1, si), 4));    // 0x0FAB1 — (기량-1)*si/4
        if (i16(AI16(mRec(team) + 0x16)) < i16(si)) si = i16(AI16(mRec(team) + 0x16));  // 0x0FACC — 표식 에너지로 자름
        wA16(mRec(team) + 0x16, i16(AI16(mRec(team) + 0x16) - si));   // 0x0FAEA — 표식[팀].+0x16 -= si
        wA32(mRec(3 - team) + 0x18, i32(AI32(mRec(3 - team) + 0x18) + (si | 0)));  // 0x0FB0A — 표식[3-팀].+0x18 += si
        if (A8(tRec(owner) + 0x03) !== team) {                        // 0x0FB12 — 다른 편이면 크레딧
          wA32(tRec(owner) + 0x28, i32(AI32(tRec(owner) + 0x28) + (si | 0)));   // 0x0FB38
          wA32(tRec(owner) + 0x30, i32(AI32(tRec(owner) + 0x30) + (si | 0)));   // 0x0FB52
        }
        if (AI16(mRec(team) + 0x16) === 0) wA8(S_ROUNDOVER, 1);       // 0x0FB6B — 에너지 0 → 라운드 끝
        // → 수렴점 0x10212
      } else {
        // ── 갈래 D — 탱크 맞음 → 피해 → 파괴 → 폭발 (0x0FB73..0x10211). ────
        const t = ownerOrMarker;                                      // [bp-6] — 맞은 탱크
        dArm: {
          if (A8(tRec(t) + 0x02) !== 0 && arr.u8(i, 0x1e) !== t) break dArm;    // 0x0FB73 — 파괴된 탱크(자기 총 제외) → 건너뜀
          if (isColour3) break dArm;                                  // 0x0FB9D — 색 3 → 건너뜀
          hit = 0xf;                                                  // 0x0FBA8 [bp-5] = 0xF
          if (A8(tRec(t) + 0x02) !== 0) { hit = 0xff; break dArm; }   // 0x0FBBE — 맞은 탱크가 이미 파괴됨 → hit=0xFF, 피해 건너뜀

          // 피격 섬광 삼각형: moveto(꼭대기) + lineto 세 번.
          const tx = sd16(A32(tRec(t) + 0x09), 50);
          const ty = sd16(A32(tRec(t) + 0x0d), 50);
          host.setColor(0xf);                                         // 0x0FBC5
          host.moveTo(i16(tx + sbyte(A8(tRec(t) + 0x43))), i16(ty + sbyte(A8(tRec(t) + 0x47))));  // 0x0FC37
          for (let di = 0; di <= 2; di++) {                           // 0x0FCB2
            host.lineTo(i16(tx + sbyte(A8(tRec(t) + 0x41 + di))), i16(ty + sbyte(A8(tRec(t) + 0x45 + di))));  // 0x0FCAA
          }

          hit = host.probe({                                          // 0x0FD3C — 탐침 #2
            x1: sd16(arr.i32(i, 0x08), 50), y1: sd16(arr.i32(i, 0x0c), 50),
            x2: sd16(newX, 50), y2: sd16(newY, 50),
            count: 2, c1: 8, c2: ownerColour, c3: 0,
          }) & 0xff;                                                  // 0x0FD41 [bp-5] = al
          host.drawTank(sbyte(t), 0);                                 // 0x0FD4C — 맞은 탱크 다시 그리기
          if (hit !== 0xf) break dArm;                                // 0x0FD51 — 탐침이 15 를 못 봤으면 피해 없음

          // ── 피해 적용 (0x0FD5A). ──────────────────────────────────────
          const owner = arr.u8(i, 0x1e);                              // 0x0FD5A [bp-5]
          // si 는 16비트 레지스터다. 32비트 더하기 자리에서 원본이 `cwd` 로 부호
          // 확장하므로 (0x0FF19 등) 여기서도 부호 있는 16비트로 유지한다.
          let si = i16(imul16(arr.i16(i, 0x16), 0xc));                // 0x0FD6B — 피해 * 12
          if (A8(tRec(owner) + 0x3b) !== 0) si = idivq(imul16(si, 5), 3);       // 0x0FD92 — 5/3
          if (A8(S_SNDMODE) === 1) {                                  // 0x0FDA1
            for (let di = 0; i16(idivq(si, 2)) > di; di++) {          // 0x0FDC3
              host.sound(u16(imul16(si, 0x32) + 0x64));               // 0x0FDB7
              host.nosound();                                         // 0x0FDBD
            }
          }
          if (A8(S_SNDMODE) === 2) wA16(S_SNDACC, u16(A16(S_SNDACC) + si));     // 0x0FDD6
          const skO = sbyte(A8((SKILL_BASE + imul16(owner, SKILL_STRIDE)) & 0xffff));  // 0x0FDDA
          if (skO > 1) si = i16(si + idivq(imul16(skO - 1, si), 4));  // 0x0FDEC
          si = i16(idivq(si, sbyte(A8(tRec(t) + 0x21))));             // 0x0FE1C — 갑옷으로 나눔
          if (A8((SKILL_BASE + imul16(t, SKILL_STRIDE)) & 0xffff) === 4) si = idivq(imul16(si, 3), 4);  // 0x0FE32 — 기량 4 → 3/4
          if (A8((SKILL_BASE + imul16(t, SKILL_STRIDE)) & 0xffff) === 5) si = idivq(i16(si * 2), 3);    // 0x0FE53 — 기량 5 → 2/3
          if (A8(tRec(t) + 0x66) !== 0) si = 0;                       // 0x0FE71 — 점멸 중 무적
          if (i16(AI16(tRec(t) + 0x22)) < i16(si)) si = i16(AI16(tRec(t) + 0x22));  // 0x0FE7E — 실드로 자름
          wA16(tRec(t) + 0x22, i16(AI16(tRec(t) + 0x22) - si));       // 0x0FE9E — 실드 -= si

          if (A8(S_TEAM) !== 0 && A8(tRec(owner) + 0x03) === A8(tRec(t) + 0x03)) {   // 0x0FEA2 — 팀 모드 + 같은 편
            let v = i32(AI32(tRec(owner) + 0x28) - (si | 0));         // 0x0FEDD — 같은 편 오사: 크레딧 뺀다
            if (v < 0) v = 0;                                         // 0x0FEE5..0x0FF11 — 0 에서 자름
            wA32(tRec(owner) + 0x28, v);
          } else {
            wA32(tRec(owner) + 0x28, i32(AI32(tRec(owner) + 0x28) + (si | 0)));     // 0x0FF2B
            wA32(tRec(owner) + 0x30, i32(AI32(tRec(owner) + 0x30) + (si | 0)));     // 0x0FF45
          }
          wA32((tRec(owner) + imul16(t, 4) + 0x15a) & 0xffff,         // 0x0FF62 — 탱크별 피해 표
            i32(AI32((tRec(owner) + imul16(t, 4) + 0x15a) & 0xffff) + (si | 0)));

          if (i16(AI16(tRec(t) + 0x22)) > 0) break dArm;              // 0x0FF6D — 실드 남았으면 파괴 없음

          // ── 파괴 (0x0FF82). ─────────────────────────────────────────
          if (owner !== 6) wA32(tRec(owner) + 0x28, i32(AI32(tRec(owner) + 0x28) + 0x1e));  // 0x0FF88 — 격추 보너스 30
          wA16(tRec(t) + 0x22, 0);                                    // 0x0FF9D — 실드 0
          wA8(tRec(t) + 0x26, 0);                                     // 0x0FFB9 — 무기 에너지 0
          wA8(tRec(t) + 0x02, 1);                                     // 0x0FFC9 — 파괴됨
          wA16(tRec(t) + 0x174, u16(A16(tRec(t) + 0x174) + 1));       // 0x0FFD9 — 죽은 수++
          if (owner !== 6) wA16(tRec(owner) + 0x172, u16(A16(tRec(owner) + 0x172) + 1));  // 0x0FFEE — 격추 수++
          wA8(S_LIVETANKS, (A8(S_LIVETANKS) - 1) & 0xff);             // 0x0FFF2 — 살아 있는 탱크--
          if ((A8(S_LIVETANKS) & 0xff) === 1 && sbyte(A8(S_TEAM)) === 0) wA8(S_ROUNDOVER, 1);  // 0x0FFF6 — 자유 대전, 한 대 남음
          host.statusPanel(1, sbyte(t));                              // 0x1000A — drawStatusPanel(1, 맞은 탱크)
          // tankMove(1) 은 탱크마다 난수를 뽑는다(0x0E1AB). runFire 와 같이 씨앗을 넘기고 되받는다 — 처음에는
          // 빠뜨려서 그 뽑기가 지워졌는데, 정답표는 이 호출을 retf 로 눌러 못 봤고 락스텝이 잡았다 (devlog 115).
          flushSeed();
          host.tankMove(1);                                           // 0x1001C — tankMove(1). retf(blindSpot), 인자만
          seed = ((A16(0x326a) << 16) | A16(0x3268)) >>> 0;
          const ringCount = sbyte(A8(tRec(t) + 0x3f));                // 0x10020 [bp-0x10]
          const rs = A8(tRec(t) + 0x21);                              // 0x10033 [bp-5] — 폭발 고리 걸음 선택

          // 폭발: [bp-2] 를 0 부터 2*ringCount 까지. 각 값마다 안쪽 루프 둘.
          //
          // ⚠ spawnObject 의 다섯째·여섯째 인자는 (a, b) 순서다(a→기준속도, b→피해량).
          //   원본이 스택에 미는 순서는 c,kind,b,a,각도,Y,X,owner (오른쪽부터 왼쪽) —
          //   즉 **b 가 a 보다 먼저 밀린다.** 두 안쪽 루프 다 "j*25+3" 값(아래 bDmg)이
          //   b 자리, "j*2+3"/"j+1" 값(아래 aSpd1/aSpd2)이 a 자리다. 처음엔 반대로
          //   짰다 — j=0(HO-3 의 유일한 바깥 반복)에서 루프1은 a==b==3 이라 안 갈렸지만
          //   루프2(a=1,b=3)에서 갈려 잡았다(HO-3 hold-out, spawnObject 인자를 직접
          //   대조해 확인, 2026-09-10).
          for (let j = 0; !(sbyte(j) > i16(ringCount * 2)); j = (j + 1) & 0xff) {  // 0x1017C
            const bDmg = ((imul16(sbyte(j), 0x19) & 0xff) + 3) & 0xff;  // 0x1005B cwde; imul; add al,3 (8비트) — b(피해)
            const aSpd1 = (((sbyte(j) << 1) & 0xff) + 3) & 0xff;        // 0x10066 shl al,1; add al,3 (8비트) — a(속도), 루프1
            // 걸음 = (갑옷==2 → 120) + (갑옷==3 → 90) + (갑옷>3 → 72). 갑옷 0·1 이면
            // 걸음이 0 이라 안쪽 루프가 안 끝난다 — 원본도 그렇다 (관측 갑옷은 3·4·5 뿐,
            // 술어 armour-class-is-at-least-two).
            let step1 = imul16(rs === 2 ? 1 : 0, 0x78);               // 0x1009E
            step1 = i16(step1 + imul16(rs === 3 ? 1 : 0, 0x5a));      // 0x100B1
            step1 = i16(step1 + imul16(sbyte(rs) > 3 ? 1 : 0, 0x48)); // 0x100C9
            for (let d = 0; !(i16(d) > 0x4650); d = i16(d + imul16(step1, 0x32))) {  // 0x100E7
              spawnObject(arr, sbyte(t), A32(tRec(t) + 0x09), A32(tRec(t) + 0x0d), d, aSpd1, bDmg, 4, 0);  // 0x10098
            }
            const aSpd2 = (j + 1) & 0xff;                             // 0x10109 inc al — a(속도), 루프2
            const step2 = i16(0x64 - imul16(i16(sbyte(rs) - 2), 0xa));  // 0x1014A..0x10167
            for (let d = 0; !(i16(d) > 0x4650); d = i16(d + imul16(step2, 0x32))) {  // 0x10170
              spawnObject(arr, sbyte(t), A32(tRec(t) + 0x09), A32(tRec(t) + 0x0d),
                idivr(i16(d + 0x8ca), 0x4650), aSpd2, bDmg, 4, 0);    // 0x10144
            }
          }
          host.drawTank(sbyte(t), 1);                                 // 0x1018C

          if (A8(S_TEAM) !== 0) {                                     // 0x10199 — 팀 모드면 편별 생존 셈
            let team1 = 0, team2 = 0;
            for (let j = 0; sbyte(j) < sbyte(A8(S_TANKS)); j = (j + 1) & 0xff) {  // 0x101DC
              if (A8(tRec(j) + 0x02) !== 0) continue;                 // 0x101AC — 파괴된 탱크 제외
              if (A8(tRec(j) + 0x03) === 1) team1 = (team1 + 1) & 0xff;  // 0x101D2
              else team2 = (team2 + 1) & 0xff;                        // 0x101D6
            }
            if (sbyte(team1) === 0) wA8(S_TEAMWIPE, 1);               // 0x101EC
            if (sbyte(team2) === 0) wA8(S_TEAMWIPE, 2);               // 0x101F9
            if (sbyte(team1) === 0 && sbyte(team2) === 0) wA8(S_TEAMWIPE, 3);  // 0x1020D
          }
        }
        // → 수렴점 0x10212
      }

      // 수렴점 0x10212.
      if (!isColour3) hit = 7;                                        // 0x1021A
      if (hit === 7 || hit === 0) armB();                             // 0x1021E
      else armA();                                                    // 0x10226 jmp 0x10502
    }

    i = (i + 1) & 0xff;                             // 0x10607 inc [bp-1]
  }

  flushSeed();
}
