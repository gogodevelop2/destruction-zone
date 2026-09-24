// @원본 0x1077D 0x121E2
//
// changeWeapon(0x121E2) — 사람 하나가 고른 무기를 그 사람이 실제로 가진 다음 무기로
// 넘긴다. 상점 화면과 라운드 준비(0x07C95)가 부른다.
//
// 인자는 player 하나(원본의 [bp+6]). 모든 접근이 `탱크 레코드 base + 상수` 이고
// base = imul16(sbyte(player), 0x176) 다. `[bx+상수]` 를 경계 검사 없이 색인하므로 dg 는
// 64KiB 통째다. 특히 재고 배열(+0x4445)을 **무기 번호 자체로** 색인한다 (아래 참조).
//
// ── 하는 일 ──────────────────────────────────────────────────────────────────
//   record +0x61 (0x445D)  이 발사가 이미 확정됐다는 표시. 0 이 아니면 함수는 아무것도
//                          안 하고 나간다. (0x1077D 가 이 표시가 서면 파괴·에너지 검사를
//                          건너뛰므로, 표시가 선 동안 무기를 못 바꾸게 해서 총알이 날아가는
//                          중에 무기가 바뀌는 것을 막는다. devlog 022 에서 정해짐.)
//   record +0x34 (0x4430)  고른 무기 번호. 이 함수가 고치는 필드.
//   record +0x49 (0x4445)  8칸짜리 그 사람 재고 배열, 무기 번호로 색인. 0 = 그 무기 없음.
//                          칸 값은 개수도 표시도 아니라 DGROUP 0x5DC 의 상점 카탈로그
//                          레코드 번호다. 0 이면 빈 칸이고, 카탈로그 0번은 이름 "nothing",
//                          약칭 "none" 이다. (devlog 020, base 는 021 에서 정정됨.)
//
// 무기 번호를 1 올리고, 8 이 되면 0 으로 되감고, 그 번호의 재고 칸이 0 인 동안 계속
// 돈다. 첫 되감기에 지역 플래그를 세워서 두 번째 되감기에서 포기한다 — 아무것도 없는
// 사람이 영원히 도는 것을 막는다. 끝난 번호가 시작 번호와 다르면 0x1261B(1, player) 로
// 무기 약칭 칸만 다시 그린다. mode 1 은 그 블록만 다시 그린다 (devlog 020).
//
// (라운드 시작 때 모든 탱크의 +0x34 는 1 이다 — 준비 함수 0x07C95 가 +0x34 가 0 인
//  탱크마다 이 함수를 부르고, 재고가 [0,15,0,0,0,0,0,0] 이라 이 루프가 1 로만 갈 수
//  있다. 게임 루프의 자동 반복 조건이 `record+0x3C != 0 && record+0x34 == 1` 이므로
//  자동 반복은 무기 번호 1 일 때만 걸린다. +0x3C 가 무엇인지는 아직 확정 안 됨 —
//  두 골든에서 0 이라 자동 반복이 안 나타났다. devlog 017 에서 정정된 사실이다.)
//
// ── 어셈블리의 두 자리 ───────────────────────────────────────────────────────
// · 재고 읽기(0x12265..0x1226D): `al = [base+0x4430]; cwde` 로 무기 번호를 **부호 확장**한
//   뒤 `bx = base + (부호 확장한 번호)`, `[bx + 0x4445]`. 0x80 이상인 무기 번호는 음수로
//   확장돼 배열 앞쪽 DGROUP 을 읽는다. 그래서 8칸으로 자르지 않는다.
// · 8비트 비교(0x1222D): `cmp byte ptr [base+0x4430], 8; jl`. 8비트 부호 비교라 0x80
//   이상(음수)이면 "< 8" 로 쳐서 되감기를 건너뛴다. 그 결과 두 가지가 나온다 (hold-out
//   으로 원본 돌려 확인, devlog 096-계열):
//     · 이 함수는 무기 번호를 0..7 밖에 남길 수 있다. 음수 구간(0x80~0xFF)에서는 되감기가
//       안 걸리므로, 그 구간의 어느 자리가 0 이 아니면 거기서 멈춘다 (hold-neg-hit 이
//       0x95 로 끝난다).
//     · 재고 배열 앞 128바이트(base+0x43C5 .. base+0x4445) 안에 **무기 번호 바이트 자신**
//       (base+0x4430)이 들어 있다. 번호 -21(0xEB) 자리가 곧 그 바이트다. 그래서
//       hold-neg-empty 는 앞쪽 128바이트가 전부 0 인데도 0 까지 안 가고 자기 번호 바이트를
//       재고 항목으로 읽어 0xEB 에서 멈춘다.
// · 마지막 호출의 두 인자에 `cbw` 가 없다(0x1228A `mov al,[bp+6]; push ax`,
//   0x1228E `mov al,1; push ax`). 밀리는 워드의 상위 바이트는 바로 앞 0x1227D 의 `imul`
//   이 ax 에 남긴 base 의 상위 바이트다. 0x1261B 는 두 인자를 `mov al, byte ptr` /
//   `cmp byte ptr` 로 바이트로만 읽으므로 이 찌꺼기는 무해하다. 그래도 원본이 push 한
//   워드 그대로 host.statusPanel 에 넘긴다 — 자르는 일은 0x1261B(= status_panel.ts) 안에
//   있다. (골든이 0x12291 에서 그 두 워드를 스택으로 잡는다.)
// · 0x12291 에 외톨이 `nop` 이 하나 있다 (`push cs; call` 바로 앞). 무엇인지 모른다.
//   Borland 가 simulated far call 앞에 넣는 정렬/자리표시로 보이나 확정 못 한다. 효과는
//   없다 — 골든 캡처가 0x12292~0x12295 를 통째로 NOP 로 덮고, nop 자체도 무동작이다.
//
// 바이트 근거는 disasm/addr_0x121E2.md. port/test/weapon.test.ts 가 정답표로 판정한다.

import { drawStatusPanelBlock,                } from "./status_panel.js";
import { ObjectArray, spawnObject } from "./objects.js";
import { sine, cosine } from "./trig.js";
import { angle as angleBetween } from "./angle.js";
import { sdiv, lmul, u32, i32 } from "./borland_long.js";
import { randStep } from "./rand.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;
/** 16비트 부호 있는 곱의 하위 16비트 (`imul dx` 다음 `mov bx,ax`). */
const imul16 = (a        , b        )         => u16(i16(a) * i16(b));

const GUARD = 0x445d; // record +0x61
const WIDX = 0x4430;  // record +0x34
const INV = 0x4445;   // record +0x49, 8칸

                             
                                                                           
                                                          
                                                  
 

/** 기본 host — status_panel.ts 로 그대로 넘긴다. drawStatusPanelBlock 이 인자를 바이트로
 *  자르므로 여기서 마스크하지 않는다. */
export function makeStatusHost(panel           , dg            )             {
  return { statusPanel: (mode, player) => drawStatusPanelBlock(panel, dg, mode, player) };
}

/** 0x121E2. dg 는 호출자가 주는 64KiB DGROUP, player 는 [bp+6]. 반환값 없음. */
export function changeWeapon(host            , dg            , player        )       {
  const base = imul16(sbyte(player), 0x176); // 0x121E8..0x121F1

  if (dg[u16(base + GUARD)] !== 0) return; // 0x121F3..0x121FA

  const start = dg[u16(base + WIDX)] & 0xff; // 0x12208..0x1220C  [bp-1]
  let wrapped = false;                       // 0x1220F  [bp-2]

  for (;;) {
    // 0x12213..0x1221E: 무기 번호 바이트 증가 (바이트 자체가 0xFF→0x00 로 감김)
    dg[u16(base + WIDX)] = (dg[u16(base + WIDX)] + 1) & 0xff;

    // 0x1222D..0x12232: cmp byte, 8 — 8비트 부호 비교. >= 8 이면 되감기.
    if (sbyte(dg[u16(base + WIDX)]) >= 8) {
      dg[u16(base + WIDX)] = 0; // 0x1223F
      if (wrapped) break;       // 0x1224A jmp 0x12276 — 두 번째 되감기면 포기
      wrapped = true;           // 0x1224C
    }

    // 0x12250..0x1226D: 재고 배열을 무기 번호(부호 확장)로 색인. 경계 검사 없음.
    const w = sbyte(dg[u16(base + WIDX)]);         // 0x12265..0x12269  al; cwde
    const inv = dg[u16(u16(base + u16(w)) + INV)]; // 0x1226A..0x1226D  bx = base + w
    if (inv !== 0) break;                          // 0x12272..0x12276  or ax,ax; jnz → 탈출
    // inv == 0 → 0x12274 je 0x12213 → 루프
  }

  // 0x12276..0x12288: 끝난 번호가 시작 번호와 같으면(바이트) 다시 그리기 생략.
  if ((dg[u16(base + WIDX)] & 0xff) === start) return;

  // 0x1228A..0x12293: status_panel(mode 1, player). push 한 두 워드의 상위 바이트 = base 의
  // 상위 바이트 (0x1228A/0x1228E 에 cbw 없음). 0x1261B 는 바이트로만 읽으므로 무해.
  const hi = (base >> 8) & 0xff;
  host.statusPanel((hi << 8) | 1, (hi << 8) | (player & 0xff));
}

// ─────────────────────────────────────────────────────────────────────────────
// 원본 0x1077D (fire-and-weapon-effects) — 1단계 명세 (작업 33, 아직 옮기지 않음)
// ─────────────────────────────────────────────────────────────────────────────
//
// 2단계에서 이 파일에 함수 `runFire` 로 옮긴다. 그때 맨 위 `// @원본` 줄이
// `0x1077D 0x121E2` 두 주소를 다 들고, port/status.tsv 127행이 `읽음` → `옮김` 이 된다.
// 지금은 명세와 크기만 낸다. 바이트 근거는 disasm/addr_0x1077D.md (명령 2,964개,
// 범위 0x1077D..0x121E1, 간접 분기 0개, 점프 표 없음).
//
// analysis/fire_and_objects.md 는 이 함수 대부분을 "아직 안 읽음" 으로 두었고, 그 안의
// 운반체 갈래 설명만 바이트로 다시 확인해 맞았다. 2단계에서 옮기면서 그 파일의 확인된
// 부분은 이 주석으로 접고 원본 note 는 지운다.
//
// ── 무엇을 하는 함수인가 ─────────────────────────────────────────────────────
// 탱크 하나가 지금 고른 무기를 한 번 쏜다. 게임 메인 루프(0x0AC29)와 로봇 오토파일럿
// (0x0B33F)이 프레임마다 부르고, 물체 갱신 함수(0x0F3CA)도 운반체가 소멸할 때 다시
// 부른다(2단계 갈래). 자기 자신도 한 번 부른다(deflector 갈래, 아래 Q4).
//
// 인자는 하나. `[bp+6]` = 탱크 색인(바이트). 반환값은 없다 — retf 하나뿐이고 부르는
// 쪽 셋 다 반환값을 안 본다.
//
// ── 판정 경계 (골든에 담을 것) ──────────────────────────────────────────────
// 이 함수는 화면 함수가 아니다. 하는 일이 전부 상태 변화다. 그래서 골든은 세 덩어리다.
//
//   1. DGROUP 변화분. 세 곳을 뜬다.
//        · 물체 배열 0x343C..0x43DC (125자리 × 32바이트) 와 개수 0x4D71
//        · 탱크 레코드가 건드려진 필드 (아래 갈래별로 다르다 — 캡처는 레코드 전체
//          0x43FC + p*0x176 .. +0x176 를 뜨는 것이 간단하다)
//        · 스칼라 0x4D63, 0x4D71 (data_writes 에 이 둘만 절대 주소로 잡힌다)
//   2. 바깥 호출의 순서 있는 목록. 이 함수가 부르는 것 중 값을 만드는 것은 전부
//      이미 옮겼으므로(아래 목록) 실제로 목록에 남는 것은:
//        · BGI setcolor / line (그리기 — 1단계 경계, 인자만)
//        · 0x1061C spawnObject 진입 (인자를 실행 순서로 기록. 함수 자체는 돌린다)
//        · death-touch 갈래의 printf/exit (Q2)
//   3. rand 소비. 갈래 0x19, 0x1A 만 rand(0x0149D)를 부른다. 그 두 경우만 endSeed 를
//      함께 뜬다. 나머지 경우는 seed 가 그대로다.
//
// spawnObject(0x1061C)는 **import 해서 실제로 돌린다** (인자만 기록하지 않는다). 세
// 갈래(운반체 2단계, deflector, ecm wiper)가 물체 배열을 훑고 줄이므로, 안 돌리면 그
// 갈래들이 훑을 것이 없다. 작업 32 의 문자열 조립을 retf 로 안 누른 것과 같은 이유다.
// 골든은 그래도 0x1061C 진입마다 인자를 따로 로그포인트로 잡아, 시험이 호출 목록과
// 배열 바이트를 둘 다 대조하게 한다.
//
// ── 공용 앞부분 A: 품목·갈래 결정과 관문 (0x1077D..0x108AE) ──────────────────
//   p    = [bp+6]                                     탱크 색인
//   base = imul16(sbyte(p), 0x176)                    탱크 레코드 시작
//   slot = dg[base + 0x4430]        (record +0x34)    지금 고른 무기 칸 번호
//   item = dg[base + slot + 0x4445] (record +0x49[])  그 칸의 상점 카탈로그 레코드 번호
//   kind = dg[item*0x3D + 0x614]    (catalogue +0x38) 동작 식별자 — 아래 갈래를 고른다
//   [bp-0x12] = item,  [bp-0x10] = kind  (둘 다 cbw 로 부호 확장한 워드)
//
//   관문 넷, 순서대로. 하나라도 걸리면 곧장 0x121DC 로(공용 뒷부분 건너뜀):
//     · slot == 0            → 0번 칸은 차체다. 차체로는 못 쏜다.
//     · record +0x61 != 0    → 이미 착수한 사격이 있다. 관문 나머지를 건너뛰고
//                              곧장 공용 앞부분 B 로 간다 (운반체 2단계).
//     · record +0x02 != 0    → 파괴된 탱크는 못 쏜다.  (0x43FE)
//     · record +0x26 < 카탈로그 +0x35   → 무기 에너지가 모자라면 안 쏜다. (0x4422/0x611)
//   관문을 통과하면:
//     record +0x26 -= 카탈로그 +0x35                   에너지를 쓴다
//     dg16(base + slot*2 + 0x444D) -= 1  (record +0x51[], 워드 배열)   수량을 하나 줄인다
//     if (그 수량 > 0) → 공용 앞부분 B 로 (정상 발사)
//     else:  record +0x49[slot] = 0                    재고 칸을 비운다
//            changeWeapon(p)                           위의 0x121E2 를 부른다
//            record +0x26 += 카탈로그 +0x35            에너지를 되돌린다
//            → 0x121DC (이 호출로는 안 쏨)
//   ⚠ 0x10821 의 `jmp 0x10840` 은 죽은 코드다. 아무도 그리로 안 뛴다 (에너지 차감을
//     건너뛰는 else 가지가 컴파일 뒤 도달 불가가 됐다). 옮길 때 넣지 않는다.
//
// ── 공용 앞부분 B: 총구 위치와 방향 (0x108B1..0x109FE) ──────────────────────
//   record +0x82[item] (dword, base + item*4 + 0x447E) += 카탈로그 +0x33 (워드)   샷당 누적량
//   record +0x156 (dword, base + 0x4552) += 1                                    쏜 횟수
//   heading = ((dg16(base+0x440D)/2 + dg16(base+0x440F)/2) % 9000) * 2   → [bp-0x2C]
//   muzzleX (dword) = dg32(base+0x4405) + cosine(heading)/10             → [bp-0x26]:[bp-0x24]
//   muzzleY (dword) = dg32(base+0x4409) + sine(heading)/10              → [bp-0x2A]:[bp-0x28]
//   (0x1383A = cosine, 0x137C5 = sine, 단위 1/50도. heading 은 짝수, 0..17998.)
//   세 계산이 판박이다 — 하나로 접는다.
//
// ── 갈래 (0x109FE..0x121AB). cmp word [bp-0x10], N 의 사슬. 점프 표 없음. ──────
// 최상위 19가지가 동작 식별자 30개를 겹치지 않게 덮는다 (anchor + 바이트로 확인).
// {1..5, 0x10..0x12, 0x22, 0x23} 열개가 한 갈래를, {0x0C..0x0E} 셋이 한 갈래를 쓴다.
// 나머지는 1:1. 아래 "→" 오른쪽은 spawnObject 인자 또는 그리기/상태.
//
//   0x00           단발.  spawn(p, muzzle, heading, a=cat+0x36, b=cat+0x33, kind=0, c=0)
//   0x0C..0x0E     record+0x61 있으면 kind-=9 하고 {1..5} 본문으로. 없으면
//                  spawn(p, muzzle, angle=0, a=0, b=cat+0x33, kind=1, c=0) + record+0x61=1
//                  (제자리 운반체. death bomp 계열.)
//   {1..5,0x10..0x12,0x22,0x23}  운반체·분열 계열. record+0x61 로 두 단계.
//     · 1단계 (+0x61==0, 0x11068):
//         spawn(p, muzzle, heading, a=cat+0x36, b=(cat+0x33)/8, kind=1, c=(kind==0x10?1:0))
//         record+0x61 = 1.   약한 운반체 하나. 유도 카운트다운은 guide blaster 만.
//     · 2단계 (+0x61!=0, 0x10ACF→0x10AE4):
//         물체 배열에서 그 운반체를 찾는다 (obj+0x18!=0 && obj+0x1E==p).
//         [bp-4..]=obj+0x00,  [bp-8..]=obj+0x04,  [bp-0xC..]=obj+0x10 / 50
//         setcolor(8); line(운반체 자리, 직전 자리)   경기장 바닥색으로 지운다
//         0x4D71--; 배열을 그 자리부터 당겨 붙인다 (22필드 × 나머지 자리)
//         그리고 갈래별 탄약 부채(payload fan)를 그 자리·방향에서 만든다:
//           1,2       si: heading+0x154 ~ +0x17C, 걸음 20(1)/10(2), dmg /3, kind=0, c=0
//           0x23      si: heading+0x145 ~ +0x18B, 걸음 10, dmg /8, kind=0, c=0
//           3,4       si: 0..0x168, 걸음 0x3C(3)/0x1E(4), dmg /6, kind=0, c=0
//           5         si: 0..0x168, 걸음 0x14, dmg /0x18, kind=0, c=0
//           0x12      si: heading+0x154 ~ +0x17C, 걸음 10, dmg /5, kind=0, c=1  (유도)
//           0x10,0x11 si: 0..0x168, 걸음 0x3C, dmg /9, kind=0, c=(0x11 이면 2)
//           0x22      si: 0..0x168, 걸음 0x3C, dmg /6, kind=2, c=0
//         일곱 부채가 판박이다 — 하나로 접고 갈래별 인자 표를 둔다.
//         끝에 record+0x61 = 0.
//   0x07           단발 유도.  spawn(..., a=cat+0x36, b=cat+0x33, kind=0, c=1)
//   {0x08,0x09,0x0A,0x18,0x1D,0x1F}  방향으로 퍼지는 부채 계열. di/si 루프 하나:
//         반복마다 sine/cosine 으로 heading 에 수직인 오프셋을 만들고 spawn.
//         0x08  di∈{-1,1} (2발), 앞, dmg /2, kind=0, c=0
//         0x09  di∈{-1,1} (2발), 뒤(heading+0xB4), dmg /2, kind=0, c=0
//         0x0A  di∈{-1,1} (2발), 앞, dmg /3~/6, kind=0, c=0
//         0x18  di∈{-1,1} (2발), 뒤, dmg /2, kind=0, c=1  (유도)
//         0x1D  di∈{-1,0,1} (3발), 뒤, dmg /3, kind=0, c=0   (rear triple)
//         0x1F  si∈{-6,-2,2,6} (4발), 앞, dmg /4, kind=0, c=0  (spark fiends)
//         여섯이 판박이다 — 하나로 접고 갈래별 인자 표를 둔다.
//   0x0B           단발.  큰 각 오프셋 (+0x1194 mod 0x4650).  kind=0, c=0
//   0x14  healer   spawn 없음.  무기 에너지 record+0x26 를 카탈로그 +0x35 만큼 또 쓰고
//                  방패 에너지 record+0x22 (0x441E) += (cat+0x33)*4, 0x190 에서 자른다.
//   0x15  death touch  spawn 없음이 아님 — 표적마다 spawn. 하지만 앞이 길다.
//                  탱크 record+0x01 로 0x1251 의 3×2워드 표를 골라 겨냥점 셋을 만들고
//                  (angle 0x138AF, sine/cosine), si 0..3 루프로 각 점을 향해
//                  host.probe(0x046CA)를 쏜다. 반환값은 host/대본에서 온다 —
//                  0x046CA 자체는 goldens/line_probe_vectors_v1 이 따로 판정한다.
//                  probe 결과에 사전 검사 셋: (-1,-1) 이면 건너뜀, 0 이면 건너뜀,
//                  (hi==0 && lo==7) 이면 건너뜀.  통과하면 owner = dg[0x127E + lo]
//                  (colour-to-owner-map).  **owner == p 이면 printf(0x25A2);
//                  calibratedBusyWait(0x1E); exit(1)** — Q2 의 그 갈래.  아니면 그
//                  표적 탱크를 향해 spawn.
//                  ⚠ [bp-0x1A]/[bp-0x22]/[bp-0x20]/[bp-0x18] 이 lea 로 색인되는 지역
//                  배열이다. 이 갈래만 프레임의 그 조각을 형있는 배열로 모델링한다.
//   0x17  ecm wiper  spawn 없음.  setcolor(8); 배열의 모든 물체를 line 으로 지운다;
//                  모든 탱크의 record+0x61 = 0;  0x4D71 = 0.   물체 배열을 통째로 비운다.
//   0x19  rear chaos  di∈{-3..3} (7발).  반복마다 rand(0x0149D) 두 번.  kind 인자 = 4.
//   0x1A  electro buds  di = rand 로 시작, 걸음 0x78, di<0x1E0 까지 (약 3~4발).
//                  kind 인자 = 5, c=1.
//   0x1B  glow/fade shield  spawn 없음.  record+0x62 (0x445E) 서 있으면 곧장 0x121DC.
//                  아니면 +0x62=1, 그리고 카탈로그 +0x35 < 0x11 이냐로 갈라
//                  record+0x66 (0x4462) = 1 또는 3, 색 목표 3바이트 record+0x6A/6B/6C
//                  (0x4466/4468/4467) = 0x3E 셋 또는 팔레트 8번 RGB (0x33C4/5/6).
//                  (anchor 의 +0x61/+0x62/+0x65/+0x66/색목표 미확정을 여기서 푼다.)
//   0x1C  teleport self  spawn 없음.  +0x62 서 있으면 0x121DC.  아니면 +0x62=1,
//                  record+0x65 (0x4461) = 1, 색 목표 = 팔레트 8번 RGB.
//   0x20  teleport foe  spawn 없음.  탱크 배열을 훑어 가장 가까운 유효한 적을 찾고
//                  (파괴 안 됨, 자기 아님, +0x62 없음, 팀 모드면 다른 팀), 그 적의
//                  +0x62=1, +0x65=1, 색 목표 설정.  거리²는 0x11D6/0x117A 로.
//   0x21  deflector  spawn 없음.  물체 배열을 훑어, 이 탱크에서 거리² < 0x28 인
//                  물체마다: 그 물체가 운반체면(obj+0x18!=0) fire(obj+0x1E) 를
//                  **재귀 호출** (Q4), 그다음 obj 의 현재/직전 위치를 맞바꾸고
//                  방향을 +0xB4(180도) 돌리고 obj+0x1E = p 로 소유권을 뺏는다.
//
// ── 공용 뒷부분: 게임 속도 재계산 (0x121AB..0x121E1) ────────────────────────
// 관문에서 안 걸리고 자기 본문에서 `jmp 0x121DC` 를 안 한 갈래는 전부 여기로 떨어진다
// (0x00, 부채 계열, 운반체, 0x0B, healer, ecm 등). 여기서:
//   0x4D63 = 0x4D6F / ( 0x4D72*2 + 0x4D65 + 0x4D71/4 )   ,  0x14 미만이면 0x14 로.
// 0x4D63 은 작업 32 의 대기 루프 나눗수("M 축")다 — 한 발 쏘면 물체 수에 따라
// 게임 속도가 다시 잡힌다.  0x121D4 의 `jge 0x121DC` 는 자르기만 건너뛴다.
//
// ── 부르는 것 (전부 이미 옮김. 그리기 둘만 1단계 경계) ─────────────────────
//   0x121E2 changeWeapon      이 파일 위     — 수량 소진 갈래에서
//   0x1061C spawnObject       objects.ts     — 22자리. import 해서 돌린다.
//   0x137C5 sine, 0x1383A cosine   trig.ts
//   0x138AF angle             angle.ts       — death touch
//   0x046CA lineProbe         line_probe.ts  — death touch (화면 색 읽음)
//   0x011D6 sdiv, 0x0117A lmul      borland_long.ts
//   0x0149D rand              rand.ts        — 갈래 0x19, 0x1A 만
//   0x136C6 calibratedBusyWait  wait.ts      — death touch 의 exit 갈래만
//   0x0347C printf, 0x0113F exit            — death touch 의 exit 갈래만
//   0x15E3E setcolor, 0x15CB1 line, 0x140B:0x1D8E setcolor, 0x140B:0x1C01 line
//                             1단계 경계 — 인자만 골든에 넣는다 (status_panel·weapon 선례)
//
// ── 1단계 판단 넷 ───────────────────────────────────────────────────────────
// Q1  서른 중 몇이 진짜 다른가.
//     최상위 갈래는 19다 (바깥 cmp/je 19개). 그중 여섯(0x08·0x09·0x0A·0x18·0x1D·0x1F)이
//     "수직 오프셋 부채" 도우미 하나로 접히고, 운반체의 payload fan 일곱이 두 번째
//     도우미 하나로 접힌다. 단발 셋(0x00·0x07·0x0B)도 거의 같다. 남는 진짜 다른 모양은
//     약 열하나: {단발}, {오프셋 부채}, {운반체(1단계+2단계 서두+payload fan)}, healer,
//     ecm wiper, glow/fade shield, teleport self, teleport foe, deflector(+재귀),
//     rear chaos(rand), electro buds(rand), death touch. death touch 가 혼자 제일 크다
//     (겨냥점 셋 + probe 루프 + exit 갈래 + 표적별 spawn, 화면 색까지 읽는다).
//
// Q2  exit 갈래를 골든이 볼 수 있는가.
//     정적으로는 죽었다고 말 못 한다. 작업 32 의 nag 블록은 산술로 항상 거짓이었지만,
//     이것은 `p == dg[0x127E + probeLo]` 라는 자료 의존 등식이다 (death touch 광선이
//     자기 색을 먼저 맞힌 경우 — 방어용 bail 로 보인다). 3단계에서 0x117DF 에
//     로그포인트를 걸고 상태 표본 프레임으로 death touch 를 여러 번 돌려 본다.
//     한 번도 안 나오면 작업 32 nag 선례대로 "관측 안 됨 — 원본의 성질" 로 적고,
//     포트는 그 경로에 닿으면 throw 한다 (나중에 갈리면 드러나게). 나오면 그 경우의
//     골든에 ret="exit1" 을 적고 포트가 그 종단을 따로 모델링한다.  입력을 지어내
//     억지로 발화시키지 않는다 — 0x046CA 의 기하를 그만큼 이해하지 못했다.
//
// Q3  0x1061C 를 import 해 부를까 인자만 적을까.
//     import 해서 부른다. 운반체 2단계·deflector·ecm wiper 세 갈래가 물체 배열을
//     훑고 줄이므로, 안 부르면 0x4D71 이 안 늘고 그 갈래들이 훑을 것이 없다.
//     0x1061C 는 이미 옮겼고(objects.ts) 그 DGROUP 쓰기가 바로 우리가 확인하려는
//     상태다.  골든은 그래도 진입마다 인자를 로그로 남겨 호출 목록과 배열 바이트를
//     둘 다 대조한다.
//
// Q4  0x11A6A 자기 재귀 — 언제, 몇 번.
//     deflector(0x21) 갈래만 재귀한다.  조건: 미는 탱크에서 거리² < 0x28 안에
//     obj+0x18 != 0 인(살아 있는 운반체) 물체가 있을 때.  그 운반체 소유자에 대해
//     fire() 를 다시 부른다.  그 소유자는 +0x61 이 서 있으므로 재귀 호출은 관문을
//     건너뛰고 운반체 2단계를 돌아 그 운반체를 제자리에서 터뜨린다.  종단: 2단계가
//     그 운반체를 배열에서 빼므로 같은 것이 두 번 안 걸린다. 깊이는 미는 탱크 근처
//     운반체 수(현실적으로 1~3), 더 깊어지려면 재귀로 불린 소유자의 고른 무기도
//     deflector여야 하는데 드물다. 탱크 수(≤6)로 묶인다.  포트는 자기를 부르고,
//     골든은 재귀 호출의 효과(운반체 터뜨림 spawn 들 + 반사·소유권 쓰기)를 순서대로
//     인라인으로 잡는다.
//
// ── 크기 (시작 전 계획) ─────────────────────────────────────────────────────
// 견줌: 작업 32 는 2,964 아닌 2,980명령에 포트+시험+캡처 합 1,464줄, 작업 31 은 1,455.
//   포트 runFire .ts        약 1,000줄
//     앞부분 A ~90 · 앞부분 B(접어) ~45 · 뒷부분 ~15 · 단발 3 ~40 ·
//     오프셋 부채 도우미+표 ~80 · 운반체(1·2단계+배열 당김+payload fan 도우미+표) ~200 ·
//     healer ~30 · death touch ~110 · ecm ~30 · rand 둘 ~75 · shield ~30 ·
//     tp self ~18 · tp foe ~55 · deflector+재귀 ~65 · 형·import·프레임 접근자·사슬 ~90
//   시험 result 계열 방식    약 150줄  (DGROUP 구간 diff + 호출 목록 + 0x4D63/0x4D71)
//   캡처 capture_lib 위      약 700줄  (상태 표본 심기 + 통제값 덮기 + 약 40경우 +
//     로그포인트 0x1061C·0x117DF·BGI·(0x15 는 픽셀 읽기) + 배열 전후 스냅샷)
//   합계 약 1,850줄.  기준(작업 32 합) 1,464 의 약 1.26배.  2배 아래.
//   초과분의 원인: 최상위 갈래 19개 중 접히지 않는 것이 열하나. 배열 당김 ~35줄과
//   death touch ~110줄(화면 색을 읽는다)이 특히 안 접힌다.
//   더 무거워지면 뺄 곳: 두 부채 도우미가 실제로 접혀야 한다(안 접히면 +150).
//   프레임 전체를 바이트로 모델링하지 않는다 — 지역 별칭은 death touch 한 곳뿐이다.
// ─────────────────────────────────────────────────────────────────────────────

// u16 / i16 / sbyte / imul16 은 이 파일 위(changeWeapon)에서 이미 정의됐다.
/** 16비트 부호 나눗셈(`cwd; idiv bx`)의 몫. 0 쪽으로 자르고 부호를 유지한다. */
const idivq = (num        , den        )         => i16(Math.trunc(i16(num) / den));
/** 같은 나눗셈의 나머지. 부호는 피제수를 따른다 (자바스크립트 `%` 와 같다). */
const idivr = (num        , den        )         => i16(num) % den;

/**
 * death touch(0x15) 갈래가 자기 색 광선을 맞혔을 때 원본은 printf 뒤 exit(1) 한다.
 * 정적으로 죽었다고 말할 수 없고 (가드가 `p == colour-to-owner-map[probe]` 라는 자료
 * 의존 등식이다), 한 번도 관측된 적이 없다. 그래서 재현하지 않고 여기서 던진다 —
 * 판정 안 받은 경로를 조용히 넘기지 않으려는 것이다. 프레임 대조에서 여기 닿으면
 * 그때 무엇을 할지 정한다. 던지는 이유가 코드에 남아야 다음 사람이 근거 없이 지우지
 * 않는다. (작업 33 3단계에서 0x117DF 로그포인트로 관측 여부를 확인한다.)
 */
export class DeathTouchSelfHitError extends Error {
           player        ;
           colour        ;
  constructor(player        , colour        ) {
    super(
      `runFire: death touch(0x15) 광선이 자기(탱크 ${player}) 색 ${colour} 을 맞혔다. ` +
      `원본은 여기서 printf 뒤 exit(1) 한다. 이 경로는 관측된 적이 없어 재현하지 않는다.`,
    );
    this.player = player;
    this.colour = colour;
    this.name = "DeathTouchSelfHitError";
  }
}

                            
                                                 
                                                    
 

                                              
                                                                
                                 
                                                            
                                                             
     
                                                                    
                                                               
                                                  
                                                           
     
                              
 

/**
 * 원본 0x1077D (fire-and-weapon-effects). 탱크 하나가 지금 고른 무기를 한 번 쏜다.
 *
 * 인자:
 *   host    BGI setcolor/line 을 받을 곳 + changeWeapon 이 쓰는 statusPanel (WeaponHost).
 *   dg      호출자가 주는 64KiB DGROUP. 탱크 레코드·카탈로그·스칼라가 전부 여기 있다.
 *   arr     날아다니는 물체 배열 (원본 DGROUP 0x343C, 개수 0x4D71). spawnObject 가
 *           덧붙이고, 운반체 2단계·deflector·ecm wiper 가 훑고 줄인다.
 *   player  원본의 [bp+6]. 탱크 색인(바이트).
 *   host.probe 가 death touch 표적 탐침의 답을 준다 (Screen 을 직접 안 받는다).
 *
 * 반환값 없음 (원본 retf, 부르는 쪽 셋 다 안 본다). death touch 자기 색 맞힘에서만
 * DeathTouchSelfHitError 를 던진다 (위 참고).
 *
 * ⚠ 원본의 절대 주소 쓰기는 [0x4D71](= arr.count) 과 [0x4D63] 둘뿐이다. 나머지 상태
 *   변화는 전부 [bx+상수] 간접이다 (탱크 레코드 dg, 물체 배열 arr).
 * ⚠ [0x4D63] 은 작업 32 결과 화면 대기 루프의 M 이다. 한 발 쏠 때마다 아래 꼬리에서
 *   물체 수에 따라 다시 계산된다 — 상수가 아니다. 프레임 대조에서 걸릴 자리다.
 */
export function runFire(
  host          , dg            , arr             , player        ,
)       {
  const dv = new DataView(dg.buffer, dg.byteOffset, dg.byteLength);

  // ── 절대 주소 DGROUP 접근 ─────────────────────────────────────────────────
  const A8 = (off        )         => dg[off & 0xffff];
  const wA8 = (off        , v        )       => { dg[off & 0xffff] = v & 0xff; };
  const A16 = (off        )         => dv.getUint16(off & 0xffff, true);
  const AI16 = (off        )         => dv.getInt16(off & 0xffff, true);
  const wA16 = (off        , v        )       => dv.setUint16(off & 0xffff, v & 0xffff, true);
  /** 두 워드를 이어 붙인 32비트 (원본은 `mov ax,[hi]; mov dx,[lo]` 로 읽는다). */
  const A32 = (loOff        )         =>
    (dv.getUint16((loOff + 2) & 0xffff, true) << 16 | dv.getUint16(loOff & 0xffff, true)) | 0;

  // ── 물체 배열 접근. 원본은 [bx + 0x343C + N] (bx = i<<5), DGROUP 위에서 경계
  //    검사 없이. arr(ObjectArray)가 같은 dg 를 감싸므로 자리 = 0x343C + i*32 + N. ─
  const oOff = (i        , off        )         => (0x343c + i * 32 + off) & 0xffff;
  const oI16 = (i        , off        )         => dv.getInt16(oOff(i, off), true);
  const oI32 = (i        , off        )         => dv.getInt32(oOff(i, off), true);
  const oU8 = (i        , off        )         => dg[oOff(i, off)];
  const woI32 = (i        , off        , v        )       => dv.setInt32(oOff(i, off), v | 0, true);
  const woI16 = (i        , off        , v        )       => dv.setInt16(oOff(i, off), i16(v), true);
  const woU8 = (i        , off        , v        )       => { dg[oOff(i, off)] = v & 0xff; };

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

  const p = sbyte(player);                           // [bp+6], cbw 로 늘 부호 확장된다

  // ═══ 공용 앞부분 A: 품목·갈래 결정과 관문 (0x1077D..0x108AE) ══════════════
  const rec = imul16(p, 0x176);                      // 0x10789  탱크 레코드 시작
  const slot = sbyte(A8((rec + 0x4430) & 0xffff));   // 0x1079A  record +0x34
  const item = sbyte(A8((rec + slot + 0x4445) & 0xffff)); // 0x107A2  record +0x49[slot]
  const cat = imul16(item, 0x3d);                    // 0x107AD  카탈로그 레코드
  let kind = sbyte(A8((cat + 0x614) & 0xffff));      // 0x107B4  카탈로그 +0x38 → 갈래 (본문에서 바뀔 수 있음)

  // 관문 1: 0번 칸(차체)은 못 쏜다. (0x107C7)
  if (A8((rec + 0x4430) & 0xffff) === 0) { flushSeed(); return; }

  // 관문 2: 이미 착수한 사격이 있으면 관문 나머지를 건너뛰고 공용 앞부분 B 로. (0x107DC)
  const shotCommitted = sbyte(A8((rec + 0x445d) & 0xffff)) !== 0;   // record +0x61

  if (!shotCommitted) {
    // 관문 3: 파괴된 탱크는 못 쏜다. (0x107F3)
    if (A8((rec + 0x43fe) & 0xffff) !== 0) { flushSeed(); return; }

    // 관문 4: 무기 에너지가 카탈로그 비용보다 적으면 안 쏜다. (0x10818)
    const cost = A8((cat + 0x611) & 0xffff);         // 카탈로그 +0x35
    const energy = A8((rec + 0x4422) & 0xffff);      // record +0x26
    if (sbyte(energy) < sbyte(cost)) { flushSeed(); return; }
    // (0x10821 의 jmp 0x10840 은 죽은 코드다. 옮기지 않는다.)
    wA8((rec + 0x4422) & 0xffff, (energy - cost) & 0xff);        // 0x1083C  에너지를 쓴다

    // 수량을 하나 줄인다. record +0x51[slot], 워드 배열, base + slot*2. (0x1085F)
    const qtyOff = (rec + slot * 2 + 0x444d) & 0xffff;
    const qty = i16(AI16(qtyOff) - 1);
    wA16(qtyOff, qty);
    if (!(qty > 0)) {
      // 수량이 0 이하 — 이 호출은 발사가 아니다. (0x10865..0x108AE)
      wA8((rec + slot + 0x4445) & 0xffff, 0);        // 재고 칸을 비운다
      changeWeapon(host, dg, player);                // 0x121E2 — 다음 가진 무기로
      wA8((rec + 0x4422) & 0xffff, (A8((rec + 0x4422) & 0xffff) + cost) & 0xff); // 에너지 환불
      flushSeed();
      return;
    }
  }

  // ═══ 공용 앞부분 B: 총구 위치와 방향 (0x108B1..0x109FE) ═══════════════════
  // record +0x82[item] (dword, rec + item*4 + 0x447E) += 카탈로그 +0x33 (워드). (0x108B1)
  {
    const accOff = (rec + imul16(item, 4) + 0x447e) & 0xffff;
    const add = A16((cat + 0x60f) & 0xffff);         // 카탈로그 +0x33, 워드
    const cur = A32(accOff);
    const sum = (cur + i16(add)) | 0;                // adc 로 상위까지
    wA16(accOff, sum & 0xffff);
    wA16((accOff + 2) & 0xffff, (sum >> 16) & 0xffff);
  }
  // record +0x156 (dword, rec + 0x4552) += 1. (0x108EB)
  {
    const shotsOff = (rec + 0x4552) & 0xffff;
    const sum = (A32(shotsOff) + 1) | 0;
    wA16(shotsOff, sum & 0xffff);
    wA16((shotsOff + 2) & 0xffff, (sum >> 16) & 0xffff);
  }

  // heading = ((idivq(rec+0x440D, 2) + idivq(rec+0x440F, 2)) % 9000) * 2. (0x108F5..0x109FE)
  // muzzleX (dword) = dg32(rec+0x4405) + idivq(cosine(heading), 10).   (0x1383A = cosine)
  // muzzleY (dword) = dg32(rec+0x4409) + idivq(sine(heading), 10).     (0x137C5 = sine)
  // 원본은 이 각도를 세 번 다시 만든다 (컴파일러가 공통식으로 안 뺐다). 값이 같으므로
  // 한 번만 만든다.
  const headSum = i16(
    idivq(AI16((rec + 0x440d) & 0xffff), 2) + idivq(AI16((rec + 0x440f) & 0xffff), 2),
  );
  const heading = u16(idivr(headSum, 0x2328) * 2);   // [bp-0x2C]
  const muzzleX = (A32((rec + 0x4405) & 0xffff) + idivq(cosine(heading), 0xa)) | 0;   // [bp-0x26]:[bp-0x24]
  const muzzleY = (A32((rec + 0x4409) & 0xffff) + idivq(sine(heading), 0xa)) | 0;     // [bp-0x2A]:[bp-0x28]

  // spawnObject 짧은 이름. arr 는 닫아 둔다. (원본 0x1061C, objects.ts)
  const spawn = (
    owner        , x        , y        , ang        ,
    a        , b        , k        , c        ,
  )       => spawnObject(arr, owner, x, y, ang, a, b, k, c);

  // 뒤로 도는 각. `((ang/50 + 180) % 360) * 50`. (kind 0x09·0x0B·0x18·0x1D 에서 쓴다)
  const rearAngle = (ang        )         =>
    imul16(idivr(i16(idivq(ang, 0x32) + 0xb4), 0x168), 0x32);

  const catB = A8((cat + 0x60f) & 0xffff);           // 카탈로그 +0x33, 바이트
  const catBW = A16((cat + 0x60f) & 0xffff);         // 카탈로그 +0x33, 워드
  const catSpeed = A8((cat + 0x612) & 0xffff);       // 카탈로그 +0x36, 바이트 (a=속도)

  // ═══ 갈래 (0x109FE..0x121AB). cmp word [bp-0x10], N 사슬. 원본의 통과 흐름 그대로. ═
  const tankX = A32((rec + 0x4405) & 0xffff);        // rec +0x09 dword
  const tankY = A32((rec + 0x4409) & 0xffff);        // rec +0x0D dword

  // ── kind == 0 : 단발. je 없이 jne 로 건너뛰므로 본문 뒤 다음 검사로 떨어진다. ──
  if (kind === 0) {
    spawn(player, muzzleX, muzzleY, heading, catSpeed, catB, 0, 0);   // 0x10A04
  }

  // ── kind 0x0C..0x0E : 운반체 표시가 있으면 kind-=9 하고 아래 {1..5} 본문으로.
  //    없으면 제자리 운반체를 만들고 표시를 세운다. (0x10A42) ─────────────────
  if (kind >= 0x0c && kind <= 0x0e) {
    if (A8((rec + 0x445d) & 0xffff) !== 0) {          // record +0x61
      kind -= 9;                                      // 0x10A60 — 3/4/5 로. 아래 운반체 if 가 잡는다.
    } else {
      spawn(player, muzzleX, muzzleY, 0, 0, catB, 1, 0);   // 0x10A66  제자리 운반체
      wA8((rec + 0x445d) & 0xffff, 1);                // 0x10AA3
    }
  }

  // ── 운반체·분열 계열 {1..5, 0x10..0x12, 0x22, 0x23}. record +0x61 로 두 단계. ──
  if ((kind >= 1 && kind <= 5) || (kind >= 0x10 && kind <= 0x12) || kind === 0x22 || kind === 0x23) {
    if (A8((rec + 0x445d) & 0xffff) === 0) {
      // 1단계 (0x11068): 약한 운반체 하나. 유도 카운트다운은 guide blaster(0x10) 만.
      spawn(player, muzzleX, muzzleY, heading, catSpeed, idivq(catBW, 8), 1, kind === 0x10 ? 1 : 0);
      wA8((rec + 0x445d) & 0xffff, 1);                // 0x110B7
    } else {
      // 2단계 (0x10AE4): 물체 배열에서 이 탱크의 운반체를 찾는다.
      let di = 0;                                     // 0x10AE4
      for (; di < (arr.count & 0xff); di++) {
        if (oI16(di, 0x18) !== 0 && oU8(di, 0x1e) === (player & 0xff)) break;
      }
      // 운반체 자리·방향을 배열이 밀리기 전에 붙잡는다. (0x10B10..0x10B4C)
      const carPrevX = oI32(di, 0x00);               // [bp-4]:[bp-6]  탄약이 나오는 자리
      const carPrevY = oI32(di, 0x04);               // [bp-8]:[bp-0xa]
      const carCurX = oI32(di, 0x08);                // 지우는 선에만 쓴다
      const carCurY = oI32(di, 0x0c);
      const headDeg = idivq(oI16(di, 0x10), 0x32);   // [bp-0xc]:[bp-0xe]  운반체 방향, 정수 도

      // 경기장 바닥색으로 운반체를 지운다. (0x10B4F..0x10BCA)
      host.setColor(8);
      host.line(
        i16(sdiv(u32(carPrevX), 0x32)), i16(sdiv(u32(carPrevY), 0x32)),
        i16(sdiv(u32(carCurX), 0x32)), i16(sdiv(u32(carCurY), 0x32)),
      );

      // 배열에서 빼고 그 자리부터 당겨 붙인다. (0x10BCD..0x10CFA)
      const oldCount = arr.count & 0xff;
      arr.count = (arr.count - 1) & 0xff;           // dec byte [0x4D71]
      if (di < oldCount) {
        dg.copyWithin(oOff(di, 0), oOff(di + 1, 0), oOff(oldCount, 0));   // 그 자리부터 당겨 붙인다
      }

      // 갈래별 탄약 부채. 일곱이 판박이다 — 인자 표 하나로 접는다. (0x10D07..0x11056)
                  
                                                               
                                                              
        
      let arm     ;
      if (kind === 1 || kind === 2) {
        arm = { startRel: 0x154, endRel: 0x17c, step: kind === 2 ? 10 : 20, bDen: 2 * kind + 1, kindArg: 0, c: 0 };
      } else if (kind === 0x23) {
        arm = { startRel: 0x145, endRel: 0x18b, step: 10, bDen: 8, kindArg: 0, c: 0 };
      } else if (kind === 3 || kind === 4) {
        arm = { absLimit: 0x168, step: kind === 4 ? 30 : 60, bDen: (kind - 2) * 6, kindArg: 0, c: 0 };
      } else if (kind === 5) {
        arm = { absLimit: 0x168, step: 20, bDen: 0x18, kindArg: 0, c: 0 };
      } else if (kind === 0x12) {
        arm = { startRel: 0x154, endRel: 0x17c, step: 10, bDen: 5, kindArg: 0, c: 1 };
      } else if (kind === 0x10 || kind === 0x11) {
        arm = { absLimit: 0x168, step: 60, bDen: 9, kindArg: 0, c: kind === 0x11 ? 2 : 0 };
      } else { // 0x22
        arm = { absLimit: 0x168, step: 60, bDen: 6, kindArg: 2, c: 0 };
      }
      const bVal = idivq(catBW, arm.bDen);
      const fire = (si        )       =>
        spawn(player, carPrevX, carPrevY, imul16(idivr(si, 0x168), 0x32), catSpeed, bVal, arm.kindArg, arm.c);
      if (arm.absLimit !== undefined) {
        for (let si = 0; si < arm.absLimit; si += arm.step) fire(si);
      } else {
        const hi = headDeg + (arm.endRel          );
        for (let si = headDeg + (arm.startRel          ); si <= hi; si += arm.step) fire(si);
      }
      wA8((rec + 0x445d) & 0xffff, 0);                // 0x11056
    }
  }

  // ── kind == 7 : 단발 유도. (0x110C7) ─────────────────────────────────────
  if (kind === 7) {
    spawn(player, muzzleX, muzzleY, heading, catSpeed, catB, 0, 1);
  }

  // 수직 오프셋 부채. kind 0x08·0x09·0x18·0x1D 가 이 모양이다. di 마다:
  //   base = (tankX + cosine/20, tankY + sine/20)
  //   Y += cosine*di/offDiv ,  X -= sine*di/offDiv
  //   spawn(player, X, Y, angleArg, speed, dmg/bDen, 0, c)
  const twinFan = (dis          , angleArg        , offDiv        , bDen        , c        )       => {
    for (const di of dis) {
      const s = i16(sine(heading));
      const co = i16(cosine(heading));
      const y = (tankY + idivq(s, 0x14) + Math.trunc((co * di) / offDiv)) | 0;
      const x = (tankX + idivq(co, 0x14) - Math.trunc((s * di) / offDiv)) | 0;
      spawn(player, x, y, angleArg, catSpeed, idivq(catBW, bDen), 0, c);
    }
  };

  if (kind === 0x08) twinFan([-1, 1], heading, 5, 2, 0);              // 0x1111A
  if (kind === 0x09) twinFan([-1, 1], rearAngle(heading), 5, 2, 0);  // 0x111FA  뒤로 두 발
  if (kind === 0x18) twinFan([-1, 1], rearAngle(heading), 5, 2, 1);  // 0x11B49  뒤로 두 발, 유도
  if (kind === 0x1d) twinFan([-1, 0, 1], rearAngle(heading), 5, 3, 0); // 0x11EC1  뒤로 세 발

  // ── kind == 0x0A : 앞으로 두 발(오프셋 /6) + 가운데 한 발(오프셋 /3). (0x112F1) ─
  if (kind === 0x0a) {
    for (const di of [-1, 1]) {
      const s = i16(sine(heading));
      const co = i16(cosine(heading));
      const y = (tankY + idivq(s, 0x14) + Math.trunc((co * di) / 6)) | 0;
      const x = (tankX + idivq(co, 0x14) - Math.trunc((s * di) / 6)) | 0;
      spawn(player, x, y, heading, catSpeed, idivq(catBW, 3), 0, 0);
    }
    // 가운데 한 발 (0x113C2) — di 없음, 앞쪽 성분이 크다.
    const s = i16(sine(heading));
    const co = i16(cosine(heading));
    const y = (tankY + idivq(s, 3) + idivq(co, 0x14)) | 0;
    const x = (tankX + idivq(co, 3) - idivq(s, 0x14)) | 0;
    spawn(player, x, y, heading, catSpeed, idivq(catBW, 3), 0, 0);
  }

  // ── kind == 0x0B : 단발. 큰 각 오프셋, kind 인자 2. (0x1148D) ───────────────
  // ⚠ 두 좌표가 sine/cosine 을 서로 바꿔 쓴다. Y(0x114D8·0x114F0): sine/2 - cosine/0x14.
  //   X(0x1151D·0x11535): cosine/2 + sine/0x14.  (호출 바이트 e81a23→0x1383A cosine,
  //   e88d22→0x137C5 sine. golden k0b-swirler 로 확인.)
  if (kind === 0x0b) {
    const s = i16(sine(heading));
    const co = i16(cosine(heading));
    const ang = idivr(u16(heading + 0x1194), 0x4650);
    const y = (tankY + idivq(s, 2) - idivq(co, 0x14)) | 0;
    const x = (tankX + idivq(co, 2) + idivq(s, 0x14)) | 0;
    spawn(player, x, y, ang, catSpeed, catB, 2, 0);
  }

  // ── kind == 0x14 : healer. spawn 없음. 무기 에너지를 방패 에너지로 옮긴다. (0x1155C) ─
  if (kind === 0x14) {
    // 원본은 slot·재고를 다시 읽는다. 그 사이 아무것도 안 바뀌므로 item·cat 그대로다.
    const cost = A8((cat + 0x611) & 0xffff);          // 카탈로그 +0x35
    const energyNow = A8((rec + 0x4422) & 0xffff);    // record +0x26 (앞부분 A 에서 이미 깎였을 수 있다)
    if (!(sbyte(cost) >= sbyte(energyNow))) {         // 0x1159A  cost >= energy 면 건너뜀
      wA8((rec + 0x4422) & 0xffff, (energyNow - cost) & 0xff);          // record +0x26 -= cost
      const shOff = (rec + 0x441e) & 0xffff;          // record +0x22
      wA16(shOff, (AI16(shOff) + ((catBW << 2) & 0xffff)) & 0xffff);    // += word(cat+0x33)*4
      if (AI16(shOff) > 0x190) wA16(shOff, 0x190);    // 0x190 에서 자른다
    }
  }

  // ── kind == 0x15 : death touch. 세 겨냥점을 만들고 삼각형 세 변으로 광선을 쏜다.
  //    광선이 자기 색을 맞히면 exit(1) (DeathTouchSelfHitError). 아니면 표적 하나에
  //    발사하고 멈춘다. (0x11607) ────────────────────────────────────────────
  if (kind === 0x15) {
    const row = sbyte(A8((rec + 0x43fd) & 0xffff));   // record +0x01 → 0x1251 표의 행
    const s0 = i16(sine(heading));
    const c0 = i16(cosine(heading));
    const tX50 = i16(sdiv(u32(tankX), 0x32));
    const tY50 = i16(sdiv(u32(tankY), 0x32));
    const AXp           = [0, 0, 0, 0];
    const CYp           = [0, 0, 0, 0];
    for (let si = 0; si < 3; si++) {                  // 0x1162D
      const t1 = sbyte(A8((0x1251 + row * 6 + si * 2) & 0xffff));
      const t2 = sbyte(A8((0x1252 + row * 6 + si * 2) & 0xffff));
      // ⚠ 원본은 곱을 16비트로 자른다. `imul dx` 가 DX:AX 에 32비트 곱을 남기는데
      //   바로 뒤의 `cwd`(disasm 에는 cdq 로 적혀 있다)가 DX 를 AX 의 부호로 덮어써서
      //   위쪽 절반이 사라진다 — 0x1164F·0x1167A·0x116D5·0x11700 네 자리가 다 같다.
      //   바깥 덧셈·뺄셈도 16비트다 (0x11683 sub dx,ax / 0x116A6 add dx,ax).
      //   표(0x1251) 의 실제 값은 최대 14 이고 cosine 은 ±999 라 곱이 13,986 을 안 넘어
      //   지금 골든 44경우에서는 자르나 안 자르나 같다. 다만 `row` 가 표 밖을 가리키면
      //   (탱크 +0x43fd 가 범위 밖) 읽히는 바이트가 ±128 까지 가고 곱이 16비트를 넘는다.
      //   2026-09-11 작업 35 의 2b 에서 실행 쪽이 같은 관용구를 옮기다 짚었다.
      AXp[si] = i16(i16(Math.trunc(i16(t1 * c0) / 0x2ee) - Math.trunc(i16(t2 * s0) / 0x2ee)) + tX50);
      CYp[si] = i16(i16(Math.trunc(i16(t1 * s0) / 0x2ee) + Math.trunc(i16(t2 * c0) / 0x2ee)) + tY50);
    }
    AXp[3] = AXp[0];                                  // 0x11742 — 삼각형을 닫는 복사
    CYp[3] = CYp[0];
    const slotP = A8((sbyte(player) + 0x126f) & 0xffff);   // player-colour-slot-table[p]
    for (let si = 0; si < 3; si++) {                  // 0x11753
      const r = host.probe({
        x1: AXp[si], y1: CYp[si], x2: AXp[si + 1], y2: CYp[si + 1],
        count: 3, c1: 8, c2: slotP, c3: 0xf,
      });                                            // 0x11793  push cs; call 0x146ca
      const rw = i16(sbyte(r));                       // 0x1179A  cbw; cwd
      if (rw === -1) continue;                        // 막힘 (0x117A2)
      if (rw === 0) continue;                         // 빈 색 (0x117B1)
      if (rw === 7) continue;                         // 색 7 (0x117BC)
      const owner = sbyte(A8((0x127e + (rw & 0xffff)) & 0xffff));   // colour-to-owner-map
      if (sbyte(player) === owner) {                  // 0x117D6  광선이 자기 색을 맞혔다
        flushSeed();
        throw new DeathTouchSelfHitError(player, rw & 0xff);
      }
      // 표적을 향해 한 발 쏘고 death touch 를 끝낸다. (0x117FD)
      const oRec = imul16(owner, 0x176);
      const oX = A32((oRec + 0x4405) & 0xffff);
      const oY = A32((oRec + 0x4409) & 0xffff);
      const ang = imul16(
        angleBetween(tX50, tY50, i16(sdiv(u32(oX), 0x32)), i16(sdiv(u32(oY), 0x32))),
        0x32,
      );
      spawn(player, tankX, tankY, ang, catSpeed, catB, 0, 0);
      break;                                          // 0x118DE  jmp 0x118e9
    }
  }

  // ── kind == 0x17 : ecm wiper. 화면의 모든 물체를 지우고 배열을 비운다. (0x118F2) ──
  if (kind === 0x17) {
    host.setColor(8);
    const oc = arr.count & 0xff;
    for (let si = 0; si < oc; si++) {
      host.line(
        i16(sdiv(u32(oI32(si, 0x00)), 0x32)), i16(sdiv(u32(oI32(si, 0x04)), 0x32)),
        i16(sdiv(u32(oI32(si, 0x08)), 0x32)), i16(sdiv(u32(oI32(si, 0x0c)), 0x32)),
      );
    }
    const tc = sbyte(A8(0x4d73));                     // [0x4d73] = 탱크 수
    for (let si = 0; si < tc; si++) wA8((imul16(si, 0x176) + 0x445d) & 0xffff, 0);  // 모든 +0x61 = 0
    arr.count = 0;                                    // [0x4d71] = 0
  }

  // ── kind == 0x21 : deflector. 가까운 물체마다 방향을 뒤집고 소유권을 뺏는다.
  //    그 물체가 운반체면 그 소유자에 대해 fire() 를 재귀 호출한다. (0x119AC) ────
  if (kind === 0x21) {
    // arr.count 는 재귀 호출이 바꿀 수 있다 — 원본처럼 매 반복 다시 읽는다.
    for (let si = 0; si < (arr.count & 0xff); si++) {
      const dxp = i16(sdiv(u32((oI32(si, 0x00) - tankX) | 0), 0x12c));   // (objX - tankX)/300
      const dyp = i16(sdiv(u32((oI32(si, 0x04) - tankY) | 0), 0x12c));   // (objY - tankY)/300
      const d2 = i32(u32(lmul(u32(dxp), u32(dxp)) + lmul(u32(dyp), u32(dyp))));
      if (!(d2 < 0x28)) continue;                     // 0x11A40  거리²가 크면 건너뜀
      if (oI16(si, 0x18) !== 0) {                     // 운반체다 — 그 소유자에 대해 재귀
        // 재귀 호출은 씨앗을 dg 에서 직접 읽고 쓴다. 우리 지역 seed 를 먼저 내려
        // 놓고, 돌아온 뒤 다시 읽는다 (deflector·운반체 2단계는 rand 를 안 쓰므로
        // 지금은 무해하지만, 갈래가 바뀌어도 어긋나지 않게 한다).
        flushSeed();
        runFire(host, dg, arr, oU8(si, 0x1e));  // 0x11A6A
        seed = ((A16(0x326a) << 16) | A16(0x3268)) >>> 0;
        seedTouched = false;
      }
      const curX = oI32(si, 0x08);                    // 재귀 뒤 다시 읽는다 (배열이 밀렸을 수 있다)
      const curY = oI32(si, 0x0c);
      const prevX = oI32(si, 0x00);
      const prevY = oI32(si, 0x04);
      woI32(si, 0x08, prevX); woI32(si, 0x0c, prevY);   // cur ← prev
      woI32(si, 0x00, curX); woI32(si, 0x04, curY);     // prev ← 옛 cur  (맞바꿈)
      woI16(si, 0x10, rearAngle(oI16(si, 0x10)));     // 방향 180도
      woU8(si, 0x1e, player & 0xff);                  // 소유권을 뺏는다
    }
  }

  // ── kind == 0x19 : rear chaos. 뒤로 흩어지는 일곱 발, 각도·속도를 rand 로. (0x11C40) ─
  if (kind === 0x19) {
    for (let di = -3; di <= 3; di++) {
      const cRaw = sdiv(u32(i16(draw()) * 2), 0x8000);              // rand*2 / 0x8000 → 0 또는 1
      const c = (cRaw + 1) & 0xff;                                   // inc al → 1 또는 2
      const b = idivq(catBW, 7);                                     // word(cat+0x33) / 7
      const aRaw = sdiv(u32(lmul(u32(A16((cat + 0x612) & 0xffff)), u32(i16(draw())))), 0x8000);
      const a = (aRaw + 1) & 0xff;                                   // rand*word(cat+0x36)/0x8000, inc al
      const ang = imul16(
        idivr(i16(idivq(heading, 0x32) + imul16(di, 0xa) + 0xb4), 0x168), 0x32,
      );
      spawn(player, muzzleX, muzzleY, ang, a, b, 4, c);
    }
  }

  // ── kind == 0x1A : electro buds. rand 로 시작한 뒤 120도 간격으로 네 발. (0x11D18) ──
  if (kind === 0x1a) {
    let di = sdiv(u32(lmul(0x78, u32(i16(draw())))), 0x8000);        // (120*rand)/0x8000
    for (; di < 0x1e0; di += 0x78) {
      spawn(
        player, muzzleX, muzzleY, imul16(idivr(di, 0x168), 0x32),
        catSpeed, idivq(catBW, 3), 5, 1,
      );
    }
  }

  // ── kind == 0x1B : glow/fade shield. spawn 없음. record +0x62/+0x66/색목표. (0x11D7B) ─
  if (kind === 0x1b) {
    if (A16((rec + 0x445e) & 0xffff) !== 0) { flushSeed(); return; }  // +0x62 서 있으면 나간다
    wA16((rec + 0x445e) & 0xffff, 1);
    if (sbyte(A8((cat + 0x611) & 0xffff)) >= 0x11) {                  // 카탈로그 +0x35 >= 0x11 (fade)
      wA8((rec + 0x4462) & 0xffff, 3);                               // +0x66 = 3
      wA8((rec + 0x4466) & 0xffff, A8(0x33c4));                      // +0x6A = 팔레트 8번 R
      wA8((rec + 0x4468) & 0xffff, A8(0x33c5));                      // +0x6C = G
      wA8((rec + 0x4467) & 0xffff, A8(0x33c6));                      // +0x6B = B
    } else {                                                         // glow
      wA8((rec + 0x4462) & 0xffff, 1);                               // +0x66 = 1
      wA8((rec + 0x4466) & 0xffff, 0x3e);
      wA8((rec + 0x4468) & 0xffff, 0x3e);
      wA8((rec + 0x4467) & 0xffff, 0x3e);
    }
  }

  // ── kind == 0x1C : teleport self. spawn 없음. record +0x65 로 자기 순간이동 요청. (0x11E43) ─
  if (kind === 0x1c) {
    if (A16((rec + 0x445e) & 0xffff) !== 0) { flushSeed(); return; }  // +0x62 서 있으면 나간다
    wA16((rec + 0x445e) & 0xffff, 1);                                // +0x62 = 1
    wA8((rec + 0x4461) & 0xffff, 1);                                 // +0x65 = 1
    wA8((rec + 0x4466) & 0xffff, A8(0x33c4));                        // 색 목표 = 팔레트 8번 RGB
    wA8((rec + 0x4468) & 0xffff, A8(0x33c5));
    wA8((rec + 0x4467) & 0xffff, A8(0x33c6));
  }

  // ── kind == 0x1F : spark fiends. heading 을 ±로 훑는 네 발, muzzle 에서. (0x11FB2) ──
  if (kind === 0x1f) {
    for (let si = -6; si <= 6; si += 4) {
      let a = i16(heading + imul16(si, 0x19));        // heading + si*25  (16비트)
      if (!(a >= 0)) a = i16(a + 0x4650);             // or di,di; jge — 음수면 0x4650 더한다
      spawn(player, muzzleX, muzzleY, u16(a), catSpeed, idivq(catBW, 4), 0, 2);
    }
  }

  // ── kind == 0x20 : teleport foe. 가장 가까운 유효한 적을 찾아 순간이동시킨다. (0x1201B) ─
  if (kind === 0x20) {
    let best = 0x7d00;                                // [bp-4]:[bp-6] 초깃값 = 0x7d00 (i16 32000)
    let bestIdx = 0;
    const tc = sbyte(A8(0x4d73));
    const myTeam = A8((rec + 0x43ff) & 0xffff);       // tank[p] +0x03
    for (let si = 0; si < tc; si++) {
      const sRec = imul16(si, 0x176);
      if (A8((sRec + 0x43fe) & 0xffff) !== 0) continue;              // 파괴됨
      if (sbyte(player) === si) continue;                            // 자기
      if (A16((sRec + 0x445e) & 0xffff) !== 0) continue;             // +0x62 (이미 걸림)
      if (A8(0x4d65) !== 0 && sbyte(myTeam) === sbyte(A8((sRec + 0x43ff) & 0xffff))) continue;  // 같은 팀
      const dxp = i16(sdiv(u32((A32((sRec + 0x4405) & 0xffff) - tankX) | 0), 0x12c));
      const dyp = i16(sdiv(u32((A32((sRec + 0x4409) & 0xffff) - tankY) | 0), 0x12c));
      const d2 = i16(u16(imul16(dxp, dxp)) + u16(imul16(dyp, dyp)));  // 16비트 저부만 — 원본이 상위를 버린다
      if (d2 < best) { best = d2; bestIdx = si; }
    }
    if (best !== 0x7d00) {                            // 표적을 찾았다
      const tRec = imul16(bestIdx, 0x176);
      if (A16((tRec + 0x445e) & 0xffff) !== 0) { flushSeed(); return; }  // 표적이 이미 걸렸다
      wA16((tRec + 0x445e) & 0xffff, 1);             // +0x62 = 1
      wA8((tRec + 0x4461) & 0xffff, 1);             // +0x65 = 1  (표적을 순간이동)
      wA8((tRec + 0x4466) & 0xffff, A8(0x33c4));
      wA8((tRec + 0x4468) & 0xffff, A8(0x33c5));
      wA8((tRec + 0x4467) & 0xffff, A8(0x33c6));
    }
  }

  // ═══ 공용 뒷부분: 게임 속도 재계산 (0x121AB). early-return 안 한 갈래는 전부 여기로. ═
  // [0x4D63] = i16(word[0x4D6F]) / ( sbyte[0x4D72]*2 + sbyte[0x4D65] + (arr.count>>2) )
  // 나눗수가 0 이면 원본은 INT 0 로 죽는다 (borland_long 의 sdiv 가 던진다).
  // ⚠ 나눗수가 0 이 될 수 있는지는 3단계에서 잰다 (capture_backlog).
  {
    let bxv = i16(sbyte(A8(0x4d72)) * 2);            // cwde; shl ax,1
    bxv = i16(bxv + sbyte(A8(0x4d65)));             // + sbyte[0x4D65]
    bxv = i16(bxv + ((arr.count & 0xff) >> 2));     // + [0x4D71]/4 (부호 없는 바이트)
    const q = sdiv(u32(i16(AI16(0x4d6f))), i16(bxv));
    wA16(0x4d63, q & 0xffff);
    if (!(AI16(0x4d63) >= 0x14)) wA16(0x4d63, 0x14);  // 0x14 미만이면 0x14 로
  }
  flushSeed();
}
