// 원본 0x0B33F(robot-autopilot). 5,063명령, 이 파일 안에 세 번(2a/2b/2c)에 걸쳐 옮겼다 —
// 2a(0x0B33F..0x0C31A: 머리 + 전방·측면 탐침 세 블록 + 표적 고르기),
// 2b(0x0C31B..0x0CF7C: 원하는 방향·회전·장애물 회피·배회·사격 표적 탐침),
// 2c(0x0CF7D..0x0DFEA: 표적 잠금 탐침 둘 + 터렛 조준 + 무기 사슬 규칙 A..H + 꼬리)
// 로 본문이 끝났다. 골든·시험은 3단계.
// 이 함수 하나가 로봇 탱크 여섯의 "생각"을 전부 한다. 인자 없음(원본 retf, [bp+N] 로
// 읽는 인자가 없다) — 탱크 배열·표식·스칼라를 DGROUP 에서 직접 읽고 쓴다.
//
// 루프 뼈대(0x0B347..0x0DFEA): `for (p=0; p<[0x4D73]; p++)`. [0x4D73] 은 "이 판의
// 탱크 수"(죽어도 안 줄어든다) — 살아있는 수 [0x4D72] 와 다르다(object_update.ts 의
// S_LIVETANKS). 사람 슬롯·파괴된 슬롯은 건너뛴다:
//   tank[p].+0x02(destroyed) != 0            → continue
//   skill[p].+0x00 (0x4CC0 기준, 보폭 0x15) == 0 → continue (0 = 사람이 모는 자리 —
//     mainloop_autopilot_v1(로봇 6)은 [1,1,1,1,1,1], human_slot_v1 은 [1,0,1,1,1,1] —
//     측정으로 확정됨, analysis/robot_autopilot.md)
// 그 뒤 이 슬롯이 로봇이면: sampleKeyboard() 호출 → +0x71(생각 주기 카운터) 증가·
// 32000 넘으면 1 로 되감기 → 기량 저장 → si=+0x11(차체 각, 1/50도) → setcolor(15).
//
// ── 탱크 레코드 (기준 0x43FC, 보폭 0x176) — 이 조각이 쓰는 자리만 ─────────────
//   +0x02  destroyed(byte)          +0x03  team(byte)
//   +0x04  주행 명령(byte, 0/1/0xFF — 사람의 스캔코드 처리기 0x0AEE3 과 같은 필드·
//          같은 세 값. 로봇은 탱크를 직접 안 움직이고 이 필드에 명령만 적는다)
//   +0x05  회전 명령(byte, 0/1/0xFF — +0x04 와 같은 규약, 사람의 좌우 회전 필드)
//   +0x09/+0x0B  X 하/상위(i32 합성, 1/50픽셀)   +0x0D/+0x0F  Y 하/상위(i32 합성)
//   +0x11  차체 각 si(i16, 1/50도)
//   +0x28/+0x2A  점수 하/상위(i32)
//   +0x6D  원하는 방향(u16, 온전한 도 0..359, 0xFFFF="없음")
//   +0x75  블록7 이 회전 명령을 바꾸기 직전에 적어 두는 이전 값(byte)
//   +0x76  사격 표적(byte). 색→소유자 표(0x127E)의 값에 1을 더해 담는다(0="없음")
//   +0x71  생각 주기 카운터(u16). 블록마다 `+0x71 % ([0x4D63]/K) == 0` 로 문턱을 건다.
//   +0x73  가장 가까운 적(byte). 슬롯 0..5, 0xFF(없음/팀 표식으로), 또는 탱크 수
//          (아직 못 찾음 — 골든 실측, analysis/robot_autopilot.md "값의 범위" 절)
//   +0x74  전략 표적(byte). 기량 1=최저 점수, 4=최고 점수, 기량 2·3·5/팀 모드=+0x73
//          복사, 그리고 교전 범위 안이면 +0x7B 이 다시 덮어쓴다(아래 참고)
//   +0x77  전방 탐침 결과(byte 0/1/2). 블록1 이 0/1 로, 팀 표식-근접 자리가 2 로 씀
//   +0x78  블록2 곁눈 탐침 결과(byte 0/1)
//   +0x79  블록3 두 번째 탐침(각 -1000) 결과(byte 0/1)
//   +0x7A  블록3 첫 탐침(각 +1000) 결과(byte 0/1)
//   +0x7B  교전 표적(byte). +0x73 를 문턱 안일 때만 복사, 아니면 0xFF
//   +0x7C/+0x7E  블록11 이 마지막으로 돈 뒤의 X/Y 하위워드 자리표시(각 u16). doc 은
//          "쓰기만 하고 아무도 안 읽는다"고 적었는데 틀렸다 — 블록11 자신이 다음
//          차례에 이것과 현재 위치를 대조해 삼각형+탐침을 다시 돌릴지 정한다.
//
// ── 표식 레코드 (기준 0x33DC, 보폭 0x20) ───────────────────────────────────
//   +0x00 X, +0x02 Y — 판 단위(탱크 위치와 맞추려면 ×50). 3-team 으로 자기 팀 표식.
// ── 기량 표 (기준 0x4CC0, 보폭 0x15) — +0x00 만 이 조각이 읽는다.
// ── 팔레트 슬롯 표 (0x126F, 보폭 1바이트) — 탱크 색인으로 직접 읽는 자기 색.
// ── 색→소유자 표 (0x127E, 보폭 1바이트) — 화면 색을 그 탱크(또는 표식) 색인으로.
// ── 삼각형 정점 표 (0x1251/0x1252, 모양당 6바이트 = 부호 있는 바이트 쌍 셋) —
//    탱크 모양(+0x01)별 삼각형 정점. weapon.ts 의 death touch 와 같은 표·같은 식.
// ── 스칼라 — 0x4D63(M, 적응형 타임스텝 비율) 0x4D65(팀 모드) 0x4D73(탱크 수)
//
// ── 정정(2026-09-11, 2a 작업 중 바이트로 다시 읽어 잡음) ───────────────────
// analysis/robot_autopilot.md 는 "기량 2·3·5 는 아직 안 읽은 세 번째 갈래로 간다"
// 고 적었는데 틀렸다. 0x0BEE4 의 `je` 방향을 다시 보면: 기량이 2·3·5 면 **팀 모드와
// 완전히 같은 자리(0x0BEEB)로 가서 +0x73 을 +0x74 에 그냥 복사한다** — 별도 갈래가
// 없다. 점수 탐색(최저/최고, 0x0BF0E)은 **기량이 1 또는 4 이고 팀 모드가 꺼져 있을
// 때만** 돈다. 그리고 0x0C241 문턱 통과 시 +0x7B(교전 표적)뿐 아니라 **+0x74(전략
// 표적)도 같이 덮어쓴다** — analysis.md 에 없던 부작용이다(가까운 적이 있으면 점수로
// 고른 전략 표적을 밀어낸다).
//
// ── 정정 둘째(2026-09-11, 2b 작업 중) ────────────────────────────────────
// analysis.md 는 블록12 의 문턱 나눗수를 "4+(기량==3)-2*(기량==1)"로 적어 기량 1
// 이면 2, 3 이면 5, 나머지는 4 라고 했다. 바이트로 다시 보니(0x0CF32..0x0CF41)
// **기량 4·5 는 거기 없던 +4 항을 하나 더 받아 나눗수가 8이다**(기량>=4 를 1로 만들어
// 두 번 왼쪽시프트해 더한다). 정확한 식은 `4+(기량>=4?4:0)+(기량==3?1:0)-(기량==1?2:0)`
// 이고 기량 1..5 의 나눗수는 2,4,5,8,8 이다(주기 94/나눗수 = 47,23,18,11,11).
// 또한 doc 은 "+0x7C·+0x7E 는 여기서 쓰고 아무 데서도 안 읽는다"고 했는데, 블록11
// 자신이 다음 차례에 이 둘을 현재 위치와 대조해 삼각형+탐침을 다시 돌릴지 정한다
// (0x0CBC0..0x0CC12) — 읽는 곳이 있다.
//
// ── 이음매(2a/2b 경계, 0x0C305..0x0C31A) ───────────────────────────────────
// `push ax`(+0x71) 뒤 `[0x4D63]/3` 을 구해 나누는 것이 한 덩어리라 중간에서 못 자른다
// (2b 지시). 경계를 그 판단이 끝난 `je` 다음(0x0C31B)으로 옮겼다. 블록4 꼬리의
// "후진 중 rand()*12/32768==0 아니면 스킵"(0x0C2E9)과, 그 스킵이 실패했을 때의 K=3
// 문턱(0x0C305) 이 둘 다 **같은 곳(0x0C4A1 = 블록6의 문턱 시작)으로 간다** — 둘 다
// "블록5 를 건너뛴다"는 뜻이다(0x0C4A1 부터 다시 읽어 확인: 블록5는 0x138AF 로 값
// 하나를 구해 +0x6D(0x4469)에 쓰고 끝나며, 그 직후 주소가 바로 0x0C4A1이다). 그래서
// 여기서는 되돌아가는 goto 대신 `skipBlock5` 플래그 하나로 옮긴다 — 2b 가 블록5의
// 문턱 조건에 `!skipBlock5 &&`를 붙이면 된다.
//
// ── 정정 셋째(2026-09-11, 2c 작업 중) — 터렛 조준·재고 칸·규칙 H ────────────
// doc(analysis.md)이 "터렛 조준 관문은 기량∈{2,4,5} && +0x40!=0 && +0x62==0" 라고
// 적었는데 **거기 이르는 길이 둘이라 하나로 뭉뚱그린 것**이었다. 바이트로 다시 보니:
//   · 0x0D364..0x0D4FC(앞이 비어야만 도는 자리) — +0x40**==0**(!=0 이 아니다) 일 때
//     열려 spreadOk 를 만든다. doc 에 아예 없던 자리다.
//   · 0x0D770..0x0D8E4(진짜 +0x13 을 쓰는 자리) — 기량∈{2,4,5}·+0x40**!=0**·+0x62==0
//     까지는 doc 대로다. **2c 가 "+0x13 을 쓰고 이어지는 건 기량>=4 뿐" 이라고 적은
//     것은 2c 자신의 오독이었다 — 3b 시험(turret-gate-skill2-no-write, 3b 보고 참고)이
//     기량 2 도 +0x13 을 쓰는 것으로 잡았다. [bp-0x27](기량) 재검사는 0x0D770..0x0D782
//     문턱 하나뿐이고, +0x13 을 쓰는 자리도 그 뒤의 viable 판정(0x0D8E4..)도 기량
//     2·4·5 가 전부 그대로 같이 밟는다 — 갈리는 자리가 없다.
// 그리고 "+0x4A"·"+0x4F" 로 따로 적어 뒀던 두 "의미 미상 필드"는 **재고 칸이었다**
// (INV_BASE=+0x49 다시 재서 확인 — inv[1]=+0x4A, inv[6]=+0x4F). 2c 를 쓰다가 처음엔
// 이 재고 칸 오프셋 자체를 `+0x49` 대신 `+0x44`(0x4400 기준)로 잘못 빼서 규칙 B·C·D
// 전부가 엉뚱한 칸을 봤다 — 파이썬으로 다시 빼서 잡았다(포트 자체의 실수, doc 과는
// 무관).
// 마지막으로 doc 의 규칙 표(A..G)는 **규칙 H 를 빠뜨렸다**(0x0DF20..0x0DFB3): 탱크
// X·Y(원시 좌표)가 둘 다 홀수이고 inv[1]이 비지 않았고 기량>=3 이면 동전을 던져 반이면
// 무기 5 로 쏜다. 그 앞에서 X·Y 가 짝수면 그 자리에서 곧장 반환한다.
//
// ── 탱크 레코드 — 2c 가 더 쓴 자리 ──────────────────────────────────────────
//   +0x13  터렛 각(u16, 1/50도)              +0x40  터렛 관문(byte, 의미 미상)
//   +0x22  (word, i16, 규칙 E 문턱)          +0x26  (byte, 규칙 E·G 문턱)
//   +0x49[8]  재고 8칸(byte). 칸 값은 상점 카탈로그 레코드 번호, 0=빈 칸
//   +0x61  이미 값을 치른 사격 표시(byte)     +0x62  실드/순간이동 점멸(word)
//   +0x81  규칙 E 의 누적 카운터(byte)
// ── 스칼라·표 추가 — 0x127B(팀별 판정색 표, 의미 미상) 0x445e=+0x62 로 재확인
//
// ── 정정 넷째(2026-09-11, 3a 캡처 장치로 잡음) ────────────────────────────
// 2c 가 앞 표적 잠금 탐침(front-lock probe) 앞의 `host.setColor(7)`(0x0D19B..0x0D19F,
// 상수 7)을 빠뜨렸었다. 원본 캡처(tools/capture_robot_autopilot.py --only
// sched-open-tank0)의 calls 열에서 setColor(7) 이 실제로 찍혀 나와 잡혔다 — 코드를
// 다시 읽어 보니 probe3() 의 인자(c1/c2/c3)와는 별개로, 그 호출 *앞*에 독립된
// setcolor 콜이 있다(뒤 탐침 앞에는 두 번째 호출이 없다 — 0x1d8e 를 부르는 곳은
// 함수 전체에 이 둘뿐, 0x0B3D1 과 0x0D19F). 고쳐서 다시 캡처하니(같은 경우) calls
// 열이 그대로 맞았다.
//
// 같은 3a 시험에서 두 번째로 잡힌 것 — `imul16` 이 **부호 없는(u16)** 값을 돌려주고
// 있었다(자기 주석은 "부호 있는 곱" 이라 적어 놓고). `idivq` 를 거치는 자리는 idivq
// 자신이 맨 먼저 `i16(num)` 을 해서 무해했지만, **32비트 누산에 직접 더하는 자리**
// (block3 의 먼 탐침점 trigMulTerm ×3, block13 의 앞뒤 탐침 ×4 자리 넷, 팀 표식 거리의
// ex/ey) 는 음수인 곱을 그대로 0..65535 양수로 더해 시험에서 x2 가 원본보다 정확히
// 65536/50≈1311 픽셀 크게 나왔다(hitA/hitB 둘 다, near 는 idivq 를 거쳐 무해했다 —
// far 만 걸렸다). `imul16` 자체를 `i16(...)` 을 돌려주게 고쳤다 — idivq 를 거치는
// 자리는 idivq 가 어차피 다시 `i16` 하므로 무해하고, 직접 더하던 자리는 이걸로 고쳐진다.
//
// 세 번째 — 조준 흔들기(wobbleDeg, 0x0CFB1..0x0CFE2)가 `imul16(4,draw())` 로 16비트를
// 잘라 썼는데, 바이트를 다시 보니 원본은 rand() 결과를 cdq 로 32비트 부호 확장하고
// lshl 로 2비트 시프트(×4, 16비트로 안 자른다)한 뒤 sdiv 로 0x8000 나눈다 — draw() 가
// 최대 0x7FFF 라 ×4 는 16비트를 넘는다. (block13 앞 탐침점이 1~2픽셀 어긋난 것으로
// 잡혔다.) 네 번째 — **flushSeed 가 아예 없었다.** draw() 는 있는데 그 값을 DGROUP
// 0x3268/0x326A 에 되써 넣는 함수가 2c 에 빠져 있었다(주석만 "2c 의 함수 끝에서
// 부른다" 고 적고 실제로 안 만들었다) — object_update.ts 와 같은 패턴으로
// flushSeed 를 추가하고, fire()(runFire, 씨앗을 직접 읽고 쓴다) 앞뒤와 함수 끝에서
// 부른다. seedAfter 골든 대조가 바로 이걸 잡았다(씨앗이 한 번도 안 바뀐 채로 나왔다).
//
// @원본 0x0B33F

                                                       
import { runFire } from "./weapon.js";
import { sine, cosine } from "./trig.js";
import { angle as angleBetween } from "./angle.js";
import { sdiv, smod, lmul, i32, u32 } from "./borland_long.js";
import { randStep } from "./rand.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;
/** 16비트 부호 있는 곱의 하위 16비트(`imul dx` 뒤 `mov bx,ax`/`cdq`). */
const imul16 = (a        , b        )         => i16(i16(a) * i16(b));
function idivGuard(den        )       {
  if ((den & 0xffff) === 0)
    throw new Error("robot_autopilot: 16비트 0 으로 나눔 — 원본의 idiv 도 여기서 0 으로 나눈다");
}
/** `cwd; idiv` 의 몫. 0 쪽으로 자른다. */
const idivq = (num        , den        )         => { idivGuard(den); return i16(Math.trunc(i16(num) / i16(den))); };
/** 같은 나눗셈의 나머지(피제수 부호를 따른다). */
const idivr = (num        , den        )         => { idivGuard(den); return i16(i16(num) % i16(den)); };
/** sdiv 의 하위 워드만(원본이 `push ax` 로 몫의 하위 워드만 쓰는 자리). */
const sd16 = (a        , b        )         => i16(sdiv(i32(a), i32(b)));

const TANK_BASE = 0x43fc, TANK_STRIDE = 0x176;
const MARK_BASE = 0x33dc;
const SKILL_BASE = 0x4cc0, SKILL_STRIDE = 0x15;
const SLOT_COLOUR = 0x126f;
const COLOUR_OWNER = 0x127e;
const COLOUR_TEAM_TABLE = 0x127b; // 의미 미상 — 팀 표식 교전 가능성 탐침의 c2 로만 쓰인다
const S_M = 0x4d63, S_TEAM = 0x4d65, S_TANKS = 0x4d73;

/** 원본이 BGI·상태창·탐침·키보드에 맡기는 것들. FireHost(→WeaponHost)를 그대로
 *  받는다 — 이 함수는 line/moveto/lineto/drawTank/tankMove/sound 를 하나도 안
 *  부른다(callees 확인, 그리기는 setcolor 2곳 + 상태판 1곳뿐). */
                                                 
                                                                     
                                                       
                         
 

/**
 * 원본 0x0B33F 한 프레임. 로봇 탱크마다 조향·조준·발사를 정한다.
 *
 * @param host  BGI·상태창·탐침·키보드를 받을 곳
 * @param dg    호출자가 주는 64KiB DGROUP
 * @param arr   날아다니는 물체 배열. 이 함수 자신은 0x343C 를 한 번도 안 건드리지만
 *              (data_writes: [], 절대주소 읽기도 0x4D63/0x4D65/0x4D73 셋뿐) 2c 에서
 *              5번 부르는 발사(0x1077D → runFire)에 그대로 넘겨야 해서 받는다.
 */
export function runAutopilot(
  host               , dg            , arr                                    , frameBp = 0xffe2,
)       {
  const dv = new DataView(dg.buffer, dg.byteOffset, dg.byteLength);

  const A8 = (off        )         => dg[off & 0xffff];
  const wA8 = (off        , v        )       => { dg[off & 0xffff] = v & 0xff; };
  const A16 = (off        )         => dv.getUint16(off & 0xffff, true);
  const wA16 = (off        , v        )       => dv.setUint16(off & 0xffff, v & 0xffff, true);
  const A32 = (loOff        )         =>
    (dv.getUint16((loOff + 2) & 0xffff, true) << 16 | dv.getUint16(loOff & 0xffff, true)) | 0;

  const tRec = (t        )         => (TANK_BASE + imul16(sbyte(t), TANK_STRIDE)) & 0xffff;

  // rand 씨앗(DGROUP 0x3268 lo / 0x326A hi). object_update.ts 와 같은 패턴 — fire()
  // (runFire, 씨앗을 직접 DGROUP 에서 읽고 쓴다) 를 부르기 직전에 flush 하고 직후에
  // 다시 읽어 온다. 함수 끝(모든 탱크 순회 뒤)에 한 번 더 flush 한다. 3a 시험(3b 전엔
  // fire() 가 안 걸렸다)이 이 flush 자체를 빠뜨렸던 것을 잡았다 — draw() 만 있고 아무
  // 데도 안 쓰는 flushSeed 가 없어 씨앗이 DGROUP 에 한 번도 안 적혔다.
  let seed = ((A16(0x326a) << 16) | A16(0x3268)) >>> 0;
  let seedTouched = false;
  const draw = ()         => {
    const r = randStep(seed);
    seed = r.next;
    seedTouched = true;
    return r.result;
  };
  const flushSeed = ()       => {
    if (!seedTouched) return;
    wA16(0x3268, seed & 0xffff);
    wA16(0x326a, (seed >>> 16) & 0xffff);
  };

  // 문턱의 나눗수 K = idivq(M, divisor). 원본은 문턱마다 [0x4D63] 을 새로 읽는다(12곳). 한 탱크가 쏘면
  // 발사(0x1077D)가 M 을 다시 계산해 쓰므로 뒤 탱크들은 새 M 으로 문턱을 잰다. 처음에는 루프 앞에서 한 번
  // 읽어 두었다가 락스텝에서 잡았다 (devlog 116).
  const M = ()         => i16(A16(S_M));
  const k8 = ()         => idivq(M(), 8);   // 블록1·2·4
  const k2 = ()         => idivq(M(), 2);   // 블록3

  // [bp-0x2a] — 점수 탐색의 승자(0x0BF65·0x0BFCB)와 조준각(0x0CFE2)이 같이 쓰는 지역.
  // 0x0BF0E 가 초기화하지 않아서 탱크에서 탱크로, 탐색에서 탐색으로 값이 넘어간다. 기량 4 의
  // 탐색에서 다른 탱크 점수가 전부 0 이면 아무도 안 이겨 넘어온 값을 +0x74 에 쓴다.
  // 이 호출에서 아직 안 썼으면 원본은 호출 전에 스택에 남은 값을 읽는다(초기화하지 않은 변수 — 의도는 추정).
  // 이 게임은 스택이 DGROUP 안이라 그 자리는 DGROUP 바이트다: 게임 루프에서 부르면 BP 0xFFE2, [bp-0x2a] = 0xFFB8.
  // 그래서 그 두 바이트를 직접 읽고 쓴다. 거기 남는 값은 앞에서 같은 깊이를 쓴 함수가 정한다 — 사람 기록 구성에서
  // 재 보니 235번 중 230번이 0x0E128 의 옛 꼭짓점 y([bp-0x28], 0x0EB70), 5번이 BGI 가 저장한 BP 0xFFE2 였다
  // (devlog 120). 탱크 이동은 frameBp 로 같은 자리에 쓴다.
  // 그 값이 6 이상이면 +0x74 가 없는 탱크를 가리키고, 표적 좌표를 탱크 표 밖(BGI 드라이버 코드 따위)에서 읽는다
  // (devlog 122). 사람이 낀 대전에서 로봇이 엉뚱한 방향으로 가는 것이 이것이다. 1단계는 그대로 두고 2단계에서
  // 고친다 (2026-09-24 사용자 결정).
  const SLOT = (frameBp - 0x2a) & 0xffff;
  const slotGet = ()         => A16(SLOT);
  const slotSet = (v        )       => wA16(SLOT, v);
  const tankCount = A8(S_TANKS);
  for (let p = 0; p < tankCount; p++) {
    const rec = tRec(p);
    if (A8((rec + 0x02) & 0xffff) !== 0) continue;               // 0x0B359 파괴됨
    const skill = A8((SKILL_BASE + p * SKILL_STRIDE) & 0xffff);  // 0x0B36B
    if (skill === 0) continue;                                    // 사람이 모는 자리

    host.sampleKeyboard();                                        // 0x0B376

    let sched = (A16((rec + 0x71) & 0xffff) + 1) & 0xffff;         // 0x0B384 inc
    if (i16(sched) > 0x7d00) sched = 1;                            // 0x0B393..0x0B3A6
    wA16((rec + 0x71) & 0xffff, sched);

    host.setColor(0xf);                                            // 0x0B3D1

    const si = i16(A16((rec + 0x11) & 0xffff));                    // 0x0B3C9 차체 각
    const cosSi = i16(cosine(si));
    const sinSi = i16(sine(si));
    const ownColour = A8((SLOT_COLOUR + sbyte(p)) & 0xffff);

    // pos(32비트) + trig*num/den 의 하위 16비트를 부호 확장해 더한다(사인·코사인이
    // 몫 하나만 쓰고 cdq 로 다시 부호 확장하는 자리, 0x0B41C 류).
    const trigDivTerm = (trig        , num        , den        )         =>
      idivq(imul16(trig, num), den);
    // 나눗셈 없이 그대로 곱만 하는 자리(블록3 의 "먼" 점, 0x0BA1C 류).
    const trigMulTerm = (trig        , num        )         => imul16(trig, num);
    // si+offset 이 항상 0 이상이 되는 자리의 단순 접기(블록1 의 +3000, 블록3 의 +1000).
    const foldSimple = (offset        )         => idivr(i16(si + offset), 0x4650);
    // si-offset 이 음수일 수 있는 자리: |si-offset| mod 18000 과 부호를 따로 낸다
    // (0x0B5E1..0x0B608 류 — 코사인은 짝함수라 부호 없이 그대로, 사인은 홀함수라
    // 부호를 곱해야 한다는 것을 바이트로 직접 확인했다).
    const foldMag = (offset        )         => idivr(Math.abs(i16(si - offset)), 0x4650);
    const foldSign = (offset        )         => (i16(si - offset) > 0 ? 1 : -1);

    const probe3 = (x1        , y1        , x2        , y2        )         =>
      host.probe({
        x1: sd16(x1, 50), y1: sd16(y1, 50), x2: sd16(x2, 50), y2: sd16(y2, 50),
        count: 3, c1: 8, c2: 0xf, c3: ownColour,
      }             );

    const baseX = A32((rec + 0x09) & 0xffff);
    const baseY = A32((rec + 0x0d) & 0xffff);

    // ═══ 블록 1 (0x0B3FD..0x0B751) — 전방 탐침 둘, +0x77 ═══════════════════
    if (idivr(sched, k8()) === 0) {
      wA8((rec + 0x77) & 0xffff, 0);                                  // 0x0B408

      // P1 = pos + cos/sin(si)*9/10  (18픽셀 앞)
      const p1x = i32(baseX + trigDivTerm(cosSi, 9, 10));
      const p1y = i32(baseY + trigDivTerm(sinSi, 9, 10));
      // P2a = P1 - cos/sin(fold(si+3000))/2  (첫 탐침, 한쪽으로 60도)
      const fold1 = foldSimple(0xbb8);
      const p2ax = i32(p1x - trigDivTerm(i16(cosine(fold1)), 1, 2));
      const p2ay = i32(p1y - trigDivTerm(i16(sine(fold1)), 1, 2));
      const hit1 = probe3(p1x, p1y, p2ax, p2ay);                      // 0x0B580
      wA8((rec + 0x77) & 0xffff, hit1 !== 0xff ? 1 : 0);               // 0x0B589..0x0B5AC

      // P2b = P1 - cos(foldMag(si-3000))/2, P1 - sign*sin(foldMag(si-3000))/2
      const fm2 = foldMag(0xbb8), fs2 = foldSign(0xbb8);
      const p2bx = i32(p1x - trigDivTerm(i16(cosine(fm2)), 1, 2));
      const p2by = i32(p1y - fs2 * trigDivTerm(i16(sine(fm2)), 1, 2));
      const hit2 = probe3(p1x, p1y, p2bx, p2by);                      // 0x0B70D
      if (hit2 !== 0xff) wA8((rec + 0x77) & 0xffff, 1);                // 0x0B716..0x0B727 (내리지는 않는다)
    }

    // ═══ 블록 2 (0x0B752..0x0B919) — 측면(뒤+옆) 탐침 하나, +0x78 ══════════
    if (idivr(sched, k8()) === 0) {
      wA8((rec + 0x78) & 0xffff, 0);                                  // 0x0B75D

      // 점1 = pos - cos(si)*7/10 - sin(si)/3,  pos - sin(si)*7/10 + cos(si)/3
      const q1x = i32(baseX - trigDivTerm(cosSi, 7, 10) - trigDivTerm(sinSi, 1, 3));
      const q1y = i32(baseY - trigDivTerm(sinSi, 7, 10) + trigDivTerm(cosSi, 1, 3));
      // 점2 = pos - cos(si)*7/10 + sin(si)/3,  pos - sin(si)*7/10 - cos(si)/3
      const q2x = i32(baseX - trigDivTerm(cosSi, 7, 10) + trigDivTerm(sinSi, 1, 3));
      const q2y = i32(baseY - trigDivTerm(sinSi, 7, 10) - trigDivTerm(cosSi, 1, 3));
      const hit = probe3(q1x, q1y, q2x, q2y);                         // 0x0B8EB
      if (hit !== 0xff) wA8((rec + 0x78) & 0xffff, 1);                 // 0x0B8F4..0x0B905
    }

    // ═══ 블록 3 (0x0B91A..0x0BDA9) — 대각 탐침 둘, +0x7A · +0x79 ═══════════
    if (idivr(sched, k2()) === 0) {
      // 공통 반경 점 = pos - cos/sin(si)*5/7
      const rx = i32(baseX - trigDivTerm(cosSi, 5, 7));
      const ry = i32(baseY - trigDivTerm(sinSi, 5, 7));

      // 탐침 A(+0x7A): 각 si+1000(단순 접기). 가까운 점 /2, 먼 점 ×3.
      const foldA = foldSimple(0x3e8);
      const cA = i16(cosine(foldA)), sA = i16(sine(foldA));
      const aNearX = i32(rx + trigDivTerm(cA, 1, 2));
      const aNearY = i32(ry + trigDivTerm(sA, 1, 2));
      const aFarX = i32(rx + trigMulTerm(cA, 3));
      const aFarY = i32(ry + trigMulTerm(sA, 3));
      const hitA = probe3(aNearX, aNearY, aFarX, aFarY);               // 0x0BAE3
      wA8((rec + 0x7a) & 0xffff, hitA !== 0xff ? 1 : 0);                // 0x0BAEC..0x0BB0F

      // 탐침 B(+0x79): 각 si-1000(부호 접기, 사인 쪽만 부호를 곱한다).
      const foldB = foldMag(0x3e8), signB = foldSign(0x3e8);
      const cB = i16(cosine(foldB)), sB = i16(sine(foldB));
      const bNearX = i32(rx + trigDivTerm(cB, 1, 2));
      const bNearY = i32(ry + signB * trigDivTerm(sB, 1, 2));
      const bFarX = i32(rx + trigMulTerm(cB, 3));
      const bFarY = i32(ry + signB * trigMulTerm(sB, 3));
      const hitB = probe3(bNearX, bNearY, bFarX, bFarY);               // 0x0BD69
      wA8((rec + 0x79) & 0xffff, hitB !== 0xff ? 1 : 0);                // 0x0BD72..0x0BD95
    }

    // ═══ 블록 4 (0x0BDAA..0x0C304) — 표적 고르기 ═══════════════════════════
    let skipBlock5 = false;
    if (idivr(sched, k8()) === 0) {
      let best = 0x7d00;                                              // 0x0BDC0 si=32000
      for (let k = 0; k < tankCount; k++) {                            // 0x0BDCA
        if (A8((tRec(k) + 0x02) & 0xffff) !== 0) continue;             // 파괴됨
        if (k === p) continue;                                        // 자기 자신
        if (A8(S_TEAM) !== 0 &&
            A8((tRec(k) + 0x03) & 0xffff) === A8((rec + 0x03) & 0xffff)) continue; // 같은 팀

        // dxr,dyr = (tank[k].pos - tank[p].pos)/300, si 와 견줄 눈금(6픽셀 단위).
        const dxr = sdiv(i32(A32((tRec(k) + 0x09) & 0xffff) - baseX), 300);
        const dyr = sdiv(i32(A32((tRec(k) + 0x0d) & 0xffff) - baseY), 300);
        const d = u16(i16(imul16(dxr, dxr)) + i16(imul16(dyr, dyr)));  // 0x0BE9B..0x0BEB5 저바이트합
        if (i16(d) < best) {                                           // 0x0BEBB
          best = i16(d);
          wA8((rec + 0x73) & 0xffff, k & 0xff);                        // 0x0BECE
        }

        // 전략 표적: 기량 2·3·5 또는 팀 모드 → +0x73 을 그대로 복사.
        // 기량 1·4 + 팀 모드 꺼짐 → 최저/최고 점수 탐색. (2026-09-11 정정, 머리 주석 참고)
        if (skill === 3 || skill === 5 || skill === 2 || A8(S_TEAM) !== 0) {
          wA8((rec + 0x74) & 0xffff, A8((rec + 0x73) & 0xffff));        // 0x0BEEB..0x0BF07
          continue;                                                     // 0x0BF0B jmp 0xc000
        }
        // 기량 1 또는 4, 팀 모드 꺼짐: 살아있는 다른 탱크를 점수로 훑는다(0x0BF0E).
        if (skill === 4) {                                              // 0x0BF22 최고 점수
          let bestHi = 0, bestLo = 0;
          for (let c = 0; c < tankCount; c++) {
            if (A8((tRec(c) + 0x02) & 0xffff) !== 0) continue;
            if (c === p) continue;
            const sHi = i16(A16((tRec(c) + 0x2a) & 0xffff));
            const sLo = A16((tRec(c) + 0x28) & 0xffff);
            if (sHi < bestHi) continue;
            if (sHi === bestHi && (sLo >>> 0) <= (bestLo >>> 0)) continue;
            slotSet(c); bestHi = sHi; bestLo = sLo;                   // 0x0BF65 / 0x0BFCB
          }
        } else if (skill === 1) {                                       // 0x0BF88 최저 점수
          let bestHi = 0x98, bestLo = 0x9680;
          for (let c = 0; c < tankCount; c++) {
            if (A8((tRec(c) + 0x02) & 0xffff) !== 0) continue;
            if (c === p) continue;
            const sHi = i16(A16((tRec(c) + 0x2a) & 0xffff));
            const sLo = A16((tRec(c) + 0x28) & 0xffff);
            if (sHi > bestHi) continue;
            if (sHi === bestHi && (sLo >>> 0) >= (bestLo >>> 0)) continue;
            slotSet(c); bestHi = sHi; bestLo = sLo;                   // 0x0BF65 / 0x0BFCB
          }
        }
        wA8((rec + 0x74) & 0xffff, slotGet() & 0xff);                   // 0x0BFEE..0x0BFFC
      }

      // 팀 모드: 자기 팀 표식까지 거리도 같은 눈금으로 재 본다(0x0C00F..0x0C16F).
      if (A8(S_TEAM) !== 0) {
        const team = A8((rec + 0x03) & 0xffff);
        const mRec = (MARK_BASE + ((3 - team) << 5)) & 0xffff;          // 0x0C048..0x0C04C
        // markerX·markerY 는 판 단위 — ×50 해야 탱크 위치(1/50픽셀)와 눈금이 맞는다.
        // 원본은 `ax=markerX; imul dx=50` 의 16비트 곱을 그대로 32비트 뺄셈에 부호
        // 확장해 쓴다(imul16 이 그 truncate 를 재현한다).
        const ex = sdiv(i32(baseX - imul16(A16(mRec), 50)), 300);
        const ey = sdiv(i32(baseY - imul16(A16((mRec + 2) & 0xffff), 50)), 300);
        // 여기는 32비트 lmul 을 그대로 쓴다(탱크쪽 저바이트-합 방식과 다르다,
        // 0x0C0E1..0x0C0EA — 값 자체는 작아 넘칠 일이 없지만 lmul 로 재현해 둔다).
        const exSq = i32(lmul(u32(ex), u32(ex)));
        const eySq = i32(lmul(u32(ey), u32(ey)));
        const D2 = i32(exSq + eySq - 50);   // 0x0C0E7..0x0C0EA add/adc, 32비트로 되접는다
        if (D2 < best) {                                                // 0x0C0ED..0x0C0F8 (si 와 비교)
          wA8((rec + 0x73) & 0xffff, 0xff);                              // 0x0C105
          wA8((rec + 0x74) & 0xffff, 0xff);                              // 0x0C115
          wA8((rec + 0x7b) & 0xffff, 0xff);                              // 0x0C125
          if (exSq + eySq < 20) wA8((rec + 0x77) & 0xffff, 2);           // 0x0C154..0x0C16A
        }
      }

      // 교전 문턱(0x0C181..0x0C2AA): +0x73(무엇이든, 0xFF 도 그대로 부호 확장해
      // 색인한다 — 원본이 경계 검사를 안 한다) 까지의 거리를 다시 재서 문턱과 견준다.
      const targetIdx = sbyte(A8((rec + 0x73) & 0xffff));
      const tgtRec = tRec(targetIdx);
      const tdxr = sdiv(i32(A32((tgtRec + 0x09) & 0xffff) - baseX), 300);
      const tdyr = sdiv(i32(A32((tgtRec + 0x0d) & 0xffff) - baseY), 300);
      // targetIdx 가 0xFF(색인 -1) 면 tgtRec 는 유효한 탱크 레코드가 아니라 그
      // 앞쪽 DGROUP 을 읽는다 — 원본이 경계 검사를 안 하므로 값이 클 수 있고,
      // 그래서 저바이트-합이 아니라 여기도 lmul 로 32비트를 그대로 쓴다.
      const Dt = i32(i32(lmul(u32(tdxr), u32(tdxr))) + i32(lmul(u32(tdyr), u32(tdyr))));  // 0x0C215..0x0C23D
      const threshold = 0x22 - (skill === 3 ? 8 : 0);                    // 0x0C241..0x0C259
      if (Dt < threshold) {                                              // 0x0C25D..0x0C266
        const near = A8((rec + 0x73) & 0xffff);
        wA8((rec + 0x7b) & 0xffff, near);                                 // 0x0C284
        wA8((rec + 0x74) & 0xffff, near);                                 // 0x0C2A4 — +0x74 도 덮인다
      } else {
        wA8((rec + 0x7b) & 0xffff, 0xff);                                 // 0x0C2B5
      }
    }

    // 후진 중(+0x04==0xFF)이면 rand()*12/32768 굴려 0 이 아니면 블록5 를 건너뛴다.
    // 블록4 의 문턱이 닫혀도 여기로 온다 — 0x0BDBD 가 `jmp 0xc2ba` 다. 처음에는 문턱 안에 두었다가
    // 락스텝에서 원본만 0x0C2D3 에서 뽑는 것을 잡았다 (devlog 115).
    if (A8((rec + 0x04) & 0xffff) === 0xff) {                            // 0x0C2BA..0x0C2CA
      const r = sdiv(i32(draw() * 12), 0x8000);                          // 0x0C2CC..0x0C2E9
      if (r !== 0) skipBlock5 = true;                                    // 0x0C2F2 jmp 0xc4a1
    }

    // ═══ 블록 5 (0x0C31B..0x0C49D) — 원하는 방향 계산 ═══════════════════════
    if (!skipBlock5 && idivr(sched, idivq(M(), 3)) === 0) {
      // 확률 문턱: total = (주행==0?0:2) + (기량==1?2:0) + (기량==2?8:0).
      // +0x7B(교전 표적)이 있으면 문턱과 무관하게 항상 다시 겨눈다(0x0C389..0x0C39F).
      const drive0 = A8((rec + 0x04) & 0xffff) === 0;
      const total = (drive0 ? 0 : 2) + (skill === 1 ? 2 : 0) + (skill === 2 ? 8 : 0);
      const roll = sdiv(i32(lmul(u32(total), u32(draw()))), 0x8000);          // 0x0C37D..0x0C384
      const hasEngageTarget = A8((rec + 0x7b) & 0xffff) !== 0xff;
      if (roll === 0 || hasEngageTarget) {
        // 표적 좌표(판 픽셀 단위): +0x73==0xFF 면 자기 팀 표식, 아니면 +0x74
        // (전략 표적, +0x73 이 아니다 — 0x0C402 에서 직접 확인) 탱크의 위치.
        let tx        , ty        ;
        if (A8((rec + 0x73) & 0xffff) === 0xff) {                              // 0x0C3AD
          const team = A8((rec + 0x03) & 0xffff);
          const mk = (MARK_BASE + ((3 - team) << 5)) & 0xffff;                 // 0x0C3C7..0x0C3E8
          tx = A16(mk); ty = A16((mk + 2) & 0xffff);                           // 판 단위라 /50 눈금과 이미 같다
        } else {
          const tgt = A8((rec + 0x74) & 0xffff);                               // 0x0C402
          const tRecT = tRec(tgt);
          ty = sd16(A32((tRecT + 0x0d) & 0xffff), 50);                         // 0x0C416
          tx = sd16(A32((tRecT + 0x09) & 0xffff), 50);                         // 0x0C442
        }
        const ownX50 = sd16(baseX, 50), ownY50 = sd16(baseY, 50);              // 0x0C462..0x0C487
        wA16((rec + 0x6d) & 0xffff, angleBetween(ownX50, ownY50, tx, ty));     // 0x0C48A..0x0C49D
      }
    }

    // ═══ 블록 6 (0x0C4A1..0x0C52F) — 임의 정지 ══════════════════════════════
    if (idivr(sched, M()) === 0) {                                               // 0x0C4B1 idiv [0x4D63] 직접
      if (A8((rec + 0x04) & 0xffff) !== 0 &&                                   // 0x0C4C4 주행 중일 때만
          (skill === 1 || skill === 2 || skill === 5)) {                       // 0x0C4CB..0x0C4DB
        const turning = A8((rec + 0x05) & 0xffff) !== 0;
        const mult = turning ? 2 : 3;                                          // 0x0C4EC..0x0C50A
        const r = sdiv(i32(lmul(u32(mult), u32(draw()))), 0x8000);             // 0x0C4DD..0x0C516
        if (r === 0) wA8((rec + 0x04) & 0xffff, 0);                            // 0x0C51D..0x0C52A
      }
    }

    // 수렴(0x0C52F): 블록6 을 돌렸든 건너뛰었든 여기로 온다.
    if (i16(A16((rec + 0x6d) & 0xffff)) !== -1) {                              // 0x0C53A — +0x6D != 0xFFFF
      // ═══ 블록 7 (0x0C544..0x0C678) — 회전 방향 + 반전 취소 ═══════════════
      if (idivr(sched, idivq(M(), 12)) === 0) {                                  // 0x0C554..0x0C565
        const wanted = i16(A16((rec + 0x6d) & 0xffff));
        const curDeg = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);             // 0x0C57F..0x0C587
        let turnDir         = wanted > curDeg ? 1 : -1;                        // 0x0C58A..0x0C599 (wanted<=cur → -1)
        const diff = wanted - curDeg;                                          // 0x0C5A7..0x0C5C2
        if (Math.abs(diff) > 180) turnDir = turnDir === 1 ? -1 : 1;            // 0x0C5D4..0x0C5DF (최단 회전으로 뒤집기)
        const oldTurn = A8((rec + 0x05) & 0xffff);
        wA8((rec + 0x75) & 0xffff, oldTurn);                                   // 0x0C5ED..0x0C5FE
        const newTurnByte = turnDir & 0xff;
        wA8((rec + 0x05) & 0xffff, newTurnByte);                               // 0x0C602..0x0C610
        if (oldTurn !== newTurnByte && oldTurn !== 0) {                        // 0x0C630..0x0C646 방향이 실제로 뒤집혔다
          wA16((rec + 0x6d) & 0xffff, 0xffff);                                 // 0x0C653
          wA8((rec + 0x05) & 0xffff, 0);                                       // 0x0C664
          wA8((rec + 0x04) & 0xffff, 1);                                       // 0x0C674
        }
      }
    }

    // ═══ 블록 8 (0x0C689..0x0C865) — 장애물 회피 (+0x77/+0x78/+0x7B 조합) ═══
    if (idivr(sched, idivq(M(), 12)) === 0) {                                    // 0x0C689..0x0C698
      // 앞은 막히고 옆은 안 막혔으면: rand()*9/32768==0(≈11%) 후진, 아니면 정지.
      if (A8((rec + 0x77) & 0xffff) !== 0 && A8((rec + 0x78) & 0xffff) === 0) { // 0x0C6AA..0x0C6C3
        const r = sdiv(i32(lmul(9, u32(draw()))), 0x8000);                     // 0x0C6C5..0x0C6E2
        wA8((rec + 0x04) & 0xffff, r === 0 ? 0xff : 0);                        // 0x0C6E7..0x0C708
      }
      // 옆만 막혔으면: 50/50 으로 정지 또는 전진.
      if (A8((rec + 0x78) & 0xffff) !== 0 && A8((rec + 0x77) & 0xffff) === 0) { // 0x0C718..0x0C731
        const r = sdiv(i32(lmul(2, u32(draw()))), 0x8000);                     // 0x0C733..0x0C746
        wA8((rec + 0x04) & 0xffff, r === 0 ? 1 : 0);                           // 0x0C74D..0x0C76C
      }
      // 교전 표적이 있으면: 대개 정지, 1/16 쯤 후진.
      if (A8((rec + 0x7b) & 0xffff) !== 0xff) {                                // 0x0C77C..0x0C781
        const gate = sdiv(i32(lmul(8, u32(draw()))), 0x8000);                  // 0x0C783..0x0C79E (×8 = lshl 3)
        const sign = gate === 0 ? 1 : 0;                                       // 0x0C7A0..0x0C7A9
        const roll2 = sdiv(i32(lmul(2, u32(draw()))), 0x8000);                 // 0x0C7AA..0x0C7BD
        const term = roll2 - 1;                                                // 0x0C7C2
        wA8((rec + 0x04) & 0xffff, imul16(sign, term) & 0xff);                 // 0x0C7C6..0x0C7D5
      }
      // 앞도 옆도 막혔으면: 정지하고 현재 각을 0~40도 흔들어 새 방향으로.
      if (A8((rec + 0x78) & 0xffff) !== 0 && A8((rec + 0x77) & 0xffff) !== 0) { // 0x0C7E4..0x0C7FB
        wA8((rec + 0x04) & 0xffff, 0);                                         // 0x0C808
        const curDeg = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);             // 0x0C818..0x0C820
        const roll3 = sdiv(i32(lmul(3, u32(draw()))), 0x8000);                 // 0x0C823..0x0C840
        const newHeading = idivr(curDeg + roll3 * 20 + 0x154, 0x168);          // 0x0C845..0x0C856
        wA16((rec + 0x6d) & 0xffff, newHeading);                               // 0x0C865
      }
    }

    // ═══ 블록 9 (0x0C879..0x0C906) — 양쪽 대각 다 뚫리고 정면도 안 막힘 ═════
    if (idivr(sched, idivq(M(), 4)) === 0) {                                     // 0x0C879..0x0C888
      if (A8((rec + 0x79) & 0xffff) !== 0 && A8((rec + 0x7a) & 0xffff) !== 0 &&
          A8((rec + 0x77) & 0xffff) === 0) {                                   // 0x0C897..0x0C8C2
        wA8((rec + 0x04) & 0xffff, 1);                                         // 0x0C8CF
        wA8((rec + 0x05) & 0xffff, 0);                                         // 0x0C8DF
        wA16((rec + 0x6d) & 0xffff, 0xffff);                                   // 0x0C8EF
      }
    }

    // ═══ 블록 10 (0x0C907..0x0CB1C) — 표적도 팀 표식도 없을 때 배회 ═════════
    // **정정 일곱째(2026-09-12, 4b HO-6-ruleG 가 잡음)**: 문턱의 둘째 비교가
    // `cmp byte ptr[bx+0x4473],2`(0x0C93D)인데 0x4473-0x43fc=0x77 이다 — +0x73(가장
    // 가까운 적)이 아니라 **+0x77(블록1 전방 탐침 결과)**을 본다. 이전엔 +0x73 로
    // 짚어 두 필드가 우연히 같은 값이던 입력에서는 안 갈렸는데, +0x77=1·+0x73=2 로
    // 갈리는 입력(HO-6, 이 세션의 실제 탱크 배치)에서 골든과 어긋나 잡혔다 — 원본은
    // 배회를 돌리는데(+0x77!=2) 포트는 안 돌렸다(+0x73==2 로 잘못 걸림).
    if (idivr(sched, idivq(M(), 12)) === 0) {                                    // 0x0C907..0x0C916
      if (A8((rec + 0x7b) & 0xffff) === 0xff && A8((rec + 0x77) & 0xffff) !== 2) { // 0x0C928..0x0C93D
        const team = A8((rec + 0x03) & 0xffff);
        const pOdd = idivr(sbyte(p), 2) !== 0;                                 // 0x0C96E..0x0C978
        const curDeg = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);
        // currentDeg + sign*rand()*10/32768, 360 으로 접는다. +360 을 더해 두면
        // 부호와 무관하게 idivr 이 그대로 참 나머지를 준다(원본이 뺄셈 쪽에서만
        // 명시적으로 +360 을 하는 이유이기도 하다 — 덧셈 쪽은 이미 항상 양수다).
        const perturb = (sign        )         => {
          const r = sdiv(i32(lmul(10, u32(draw()))), 0x8000);
          return idivr(curDeg + 0x168 + sign * r, 0x168);
        };
        if (team === 2 || (team === 0 && pOdd)) {
          if (A8((rec + 0x7a) & 0xffff) !== 0) wA16((rec + 0x6d) & 0xffff, perturb(-1)); // 0x0C98A..0x0C9E4
          if (A8((rec + 0x79) & 0xffff) !== 0) wA16((rec + 0x6d) & 0xffff, perturb(1));  // 0x0C9F3..0x0CA4A
        } else {
          if (A8((rec + 0x79) & 0xffff) !== 0) wA16((rec + 0x6d) & 0xffff, perturb(1));  // 0x0CA5C..0x0CAB3
          if (A8((rec + 0x7a) & 0xffff) !== 0) wA16((rec + 0x6d) & 0xffff, perturb(-1)); // 0x0CAC2..0x0CB1C
        }
      }
    }

    // ═══ 블록 11 (0x0CB20..0x0CF21) — 사격 표적 탐침 + 자리 캐시 ════════════
    // [bp-0x28] 은 이 지점(블록11 의 문턱보다도 앞)에서 매 프레임 0 으로 눌렸다가
    // 자리 캐시가 맞을 때만 1이 된다. doc(1단계 uncertain)은 "블록11 이 0x0CB20 에서
    // 지우고 0x0CC17 에서 세우고 규칙 A(2c, 0x0DB7C)가 문턱으로 쓴다"고만 적었다 —
    // 소비처가 2c 라 그 값 자체는 여기서 못 끝맺고 넘긴다(skipBlock5 와 같은 방식).
    let ruleAGate = false;                                                     // 0x0CB20
    if (idivr(sched, idivq(M(), 2)) === 0) {                                     // 0x0CB34..0x0CB43
      if (A8((rec + 0x04) & 0xffff) === 0xff) {                                // 0x0CB55 후진 중
        const r = sdiv(i32(lmul(2, u32(draw()))), 0x8000);                     // 0x0CB5C..0x0CB74
        if (r === 0) {
          const r2 = sdiv(i32(lmul(2, u32(draw()))), 0x8000);                  // 0x0CB78..0x0CB8B
          wA8((rec + 0x05) & 0xffff, (r2 === 0 ? -1 : 1) & 0xff);              // 0x0CB90..0x0CBA1
        }
      }
      wA8((rec + 0x76) & 0xffff, 0);                                           // 0x0CBB0 사격 표적 비움

      // +0x7C/+0x7E: 지난번 이 블록을 돈 뒤의 X/Y 하위워드 자리표시. 지금 위치가
      // 그것의 부호 확장과 (32비트로) 그대로 같으면 삼각형+탐침을 돌린다.
      const cacheX = i16(A16((rec + 0x7c) & 0xffff));                          // 0x0CBC0
      const cacheY = i16(A16((rec + 0x7e) & 0xffff));
      if (A32((rec + 0x09) & 0xffff) === cacheX &&                             // 0x0CBD3..0x0CBE1
          A32((rec + 0x0d) & 0xffff) === cacheY) {                             // 0x0CC04..0x0CC12
        ruleAGate = true;                                                      // 0x0CC17
        const rowIdx = sbyte(A8((rec + 0x01) & 0xffff));                       // 0x0CC26..0x0CC39 ([bp-0x14] 재사용)
        const tX50 = sd16(A32((rec + 0x09) & 0xffff), 50);
        const tY50 = sd16(A32((rec + 0x0d) & 0xffff), 50);
        const term = (t        , trig        )         => idivq(imul16(t, trig), 0x2ee);
        const AXp           = [0, 0, 0, 0], CYp           = [0, 0, 0, 0];
        for (let k = 0; k < 3; k++) {                                          // 0x0CC44..0x0CD60
          const t1 = sbyte(A8((0x1251 + rowIdx * 6 + k * 2) & 0xffff));
          const t2 = sbyte(A8((0x1252 + rowIdx * 6 + k * 2) & 0xffff));
          AXp[k] = i16(term(t1, cosSi) - term(t2, sinSi) + tX50);
          CYp[k] = i16(term(t1, sinSi) + term(t2, cosSi) + tY50);
        }
        AXp[3] = AXp[0]; CYp[3] = CYp[0];                                      // 0x0CD6C..0x0CD75

        const probeDirect = (x1        , y1        , x2        , y2        )         =>
          host.probe({ x1, y1, x2, y2, count: 3, c1: 8, c2: ownColour, c3: 0xf }             );

        for (let k = 0; k < 3; k++) {                                          // 0x0CD7F..0x0CEDF
          const hit = probeDirect(AXp[k], CYp[k], AXp[k + 1], CYp[k + 1]) & 0xff; // 0x0CDD0
          if (hit === 0xff) continue;                                          // 0x0CDDA 막힘, 다음 변

          const rA = sdiv(i32(lmul(5, u32(draw()))), 0x8000);                  // 0x0CDE3..0x0CE00
          wA8((rec + 0x04) & 0xffff, (rA === 0 ? 1 : -1) & 0xff);              // 0x0CE05..0x0CE1B

          const curDeg2 = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);          // 0x0CE2A..0x0CE32
          const rB = sdiv(i32(lmul(7, u32(draw()))), 0x8000);                  // 0x0CE35..0x0CE52
          wA16((rec + 0x6d) & 0xffff, idivr(curDeg2 + rB * 20 + 0x12c, 0x168)); // 0x0CE57..0x0CE77

          const rC = sdiv(i32(lmul(3, u32(draw()))), 0x8000);                  // 0x0CE7B..0x0CE98
          wA8((rec + 0x05) & 0xffff, (rC - 1) & 0xff);                         // 0x0CE9D..0x0CEAC

          if (hit === 0 || hit === 7) continue;                                // 0x0CEB0..0x0CEBA 검정·파괴색은 표적 아님

          const owner = A8((COLOUR_OWNER + hit) & 0xffff);                     // 0x0CEC8
          wA8((rec + 0x76) & 0xffff, (owner + 1) & 0xff);                      // 0x0CED0
          break;                                                                // 0x0CED4
        }
      }
      // 자리표시 갱신(0x0CEE2..0x0CF1E) — 캐시가 맞았든 아니든 항상 온다.
      wA16((rec + 0x7c) & 0xffff, A16((rec + 0x09) & 0xffff));
      wA16((rec + 0x7e) & 0xffff, A16((rec + 0x0d) & 0xffff));
    }

    // ═══ 이음매(2b/2c 경계, 0x0CF22..0x0CF7C) — 블록12 자신의 문턱 ══════════
    // divisor = 4 + (기량>=4 ? 4:0) + (기량==3 ? 1:0) - (기량==1 ? 2:0). 바이트로
    // 다시 확인(0x0CF32..0x0CF41) — analysis.md 의 "4+(기량==3)-2*(기량==1)" 는
    // 기량 4·5 가 +4 항을 하나 더 받는다는 것을 빠뜨렸다(기량>=4 를 ax=1 로 만들어
    // shl,shl 로 4를 곱해 더한다). 못 넘으면 이번 프레임 이 탱크의 나머지 전부를
    // 건너뛴다(원본 jmp 0xdfd6 = p 루프의 증가 자리, 곧 continue).
    const b12Divisor = 4 + (skill >= 4 ? 4 : 0) + (skill === 3 ? 1 : 0) - (skill === 1 ? 2 : 0);
    if (idivr(sched, idivq(M(), b12Divisor)) !== 0) continue;                    // 0x0CF6A..0x0CF7A

    // ═══ 블록 12/13 (0x0CF7D..0x0DFEA) — 조준 흔들기 + 터렛 조준 + 무기 사슬 ══
    // 조준각 = (차체각/50 + rand()*4/32768 + 360) % 360, 그 뒤 다시 *50(1/50도 단위).
    // "최대 3도" — rand()*4/32768 은 0..3.
    // rand()(0..0x7FFF)을 cdq 로 32비트로 부호 확장하고 lshl 로 2비트 왼쪽시프트(×4,
    // 16비트로 안 자른다 — 0x0CFBE..0x0CFC1)한 뒤 0x8000 으로 sdiv 한다(0x0CFC8).
    // 그 나눗수(0x8000)는 바로 앞의 rand(0,0x8000) 호출이 자기 인자로 쓰고 정리하지
    // 않아 스택에 그대로 남아 재사용된다(이 저장소가 이미 아는 관용구). 예전엔
    // imul16(4,draw()) 로 16비트를 잘라 썼는데, draw() 가 최대 0x7FFF 라 ×4 가 16비트를
    // 넘는다(최대 0x1FFFC) — 3a 시험이 잡았다(front-lock 먼 탐침점이 1~2픽셀 어긋났다).
    const wobbleDeg = idivr(idivq(si, 50) + sdiv(draw() * 4, 0x8000) + 0x168, 0x168);
    const aimAngle = wobbleDeg * 50;                                            // 0x0CFE2 [bp-0x2a]
    slotSet(aimAngle);
    const shapeRow = sbyte(A8((rec + 0x01) & 0xffff));                          // 0x0CFF5 [bp-0x14]
    // runFire 는 씨앗을 직접 DGROUP 에서 읽고 쓴다(object_update.ts 와 같은 경계) —
    // 부르기 전에 flush 해서 최신 값을 보게 하고, 부른 뒤 다시 읽어 이어 그린다.
    const fire = ()       => {
      flushSeed();
      runFire(host, dg, arr, p);
      seed = ((A16(0x326a) << 16) | A16(0x3268)) >>> 0;
      seedTouched = false;
    };
    // [bp-2](원본 0x0DB79)는 사슬 직전 무기 번호를 담아 꼬리에서 다시 그릴지 정한다.
    // "이미 값을 치른 사격"/"+0x76 강제" 로 일찍 반환하는 두 경로는 원본에서 이
    // 자리를 아직 안 쓴 채라 블록4 의 k 루프가 남긴 찌꺼기(또는 그 전 프레임 것)를
    // 읽는다 — 함수 호출 하나 안의 진짜 스택 재사용이라 정적으로 못 정한다. 여기서는
    // 그 두 경로에서도 "지금 무기 번호"로 재는 것으로 갈음한다(정상 경로는 어차피
    // 0x0DB79 지점까지 +0x34 를 아무도 안 건드려 원본과 값이 같다) — 2c 판단.
    const weaponBefore = A8((rec + 0x34) & 0xffff);

    // 사격 전체를 감싼다 — "jmp 0xd058"(쏘고 끝) 은 fire();break fireDone, "jmp 0xdfb4"
    // (그냥 끝, doc 의 "반환") 은 break fireDone 으로 옮긴다. 둘 다 아래 꼬리(무기가
    // 바뀌었으면 상태판 다시 그리기)로 합류한다 — 원본도 0xd058/0xdfb4 모두 그 꼬리로
    // 떨어진다.
    fireDone: {
      if (A8((rec + 0x61) & 0xffff) !== 0) {                                    // 0x0D003 이미 값을 치른 사격
        if (skill >= 3 && sdiv(i32(lmul(2, u32(draw()))), 0x8000) !== 0) break fireDone; // 0x0D00A..0x0D02A
        if (sdiv(i32(lmul(9, u32(draw()))), 0x8000) !== 0) break fireDone;      // 0x0D02F..0x0D051
        fire();
        break fireDone;                                                        // 0x0D058..0x0D062
      }

      // +0x76(사격 표적)이 있고 inv[6](+0x4F, 재고 6번 칸)이 비지 않았으면: 팀 모드가
      // 아니거나 표적이 다른 팀이면 무기 6(death touch)으로 강제하고 쏜다. (재고
      // 칸 산수를 다시 재서 확정 — "의미 미상 필드" 가 아니라 재고 칸이었다.)
      let forced = false;                                                      // 0x0D065..0x0D0D5
      if (A8((rec + 0x76) & 0xffff) !== 0 && A8((rec + 0x4f) & 0xffff) !== 0) {
        const fireTgt = A8((rec + 0x76) & 0xffff);
        const sameTeam = A8(S_TEAM) !== 0 &&
          A8((TANK_BASE + (fireTgt - 1) * TANK_STRIDE + 0x03) & 0xffff) === A8((rec + 0x03) & 0xffff);
        if (!sameTeam) {
          wA8((rec + 0x34) & 0xffff, 6);
          forced = true;
        }
      }
      if (forced) { fire(); break fireDone; }

      // ── 표적 잠금 탐침 둘: 앞(흔든 조준각, 2/3~4배)·뒤(차체각, -1~-4배) ──────
      let frontClear = false;                                                  // 0x0CF89 [bp-0x2e]
      let frontColour = 0, rearColour = 0;                                     // [bp-0x2b] [bp-0x2c]
      const cosAim = i16(cosine(aimAngle)), sinAim = i16(sine(aimAngle));
      {
        const nx = i32(baseX + idivq(imul16(cosAim, 2), 3));                    // 0x0D0D7..0x0D107 2/3배
        const ny = i32(baseY + idivq(imul16(sinAim, 2), 3));                    // 0x0D10A..0x0D13A
        const fx = i32(baseX + imul16(cosAim, 4));                              // 0x0D13D..0x0D169 4배(안 나눈다)
        const fy = i32(baseY + imul16(sinAim, 4));                              // 0x0D16C..0x0D198
        host.setColor(7);                                                      // 0x0D19B..0x0D19F — 상수 7, 앞·뒤 탐침 둘 다 이 한 번으로 덮인다(다음 setcolor 없음)
        const hit = probe3(nx, ny, fx, fy) & 0xff;                              // 0x0D206

        if (hit === 0xff) frontClear = true;                                    // 0x0D213
        else if (hit !== 0 && hit !== 7) frontColour = hit;                     // 0x0D215..0x0D224
      }
      {
        const nx = i32(baseX - cosSi);                                          // 0x0D22D..0x0D253 -1배
        const ny = i32(baseY - sinSi);                                          // 0x0D256..0x0D27C
        const fx = i32(baseX - imul16(cosSi, 4));                               // 0x0D27F..0x0D2A9 -4배
        const fy = i32(baseY - imul16(sinSi, 4));                               // 0x0D2AC..0x0D2D6
        const hit = probe3(nx, ny, fx, fy) & 0xff;                              // 0x0D2D9..0x0D33D
        if (hit !== 0xff && hit !== 0 && hit !== 7) rearColour = hit;           // 0x0D343..0x0D358 (0xFF 도 그냥 무시 — 뒤쪽엔 "비었다" 표시가 없다)
      }

      // ── 아군-근접 회피(문서에 없던 자리, 0x0D364..0x0D4FB) ───────────────
      // 앞이 비었고 +0x73 가 있고 기량!=3 이고 +0x40==0 일 때만: 가장 가까운 표적(+0x73,
      // 0x0D3AB 의 [bx+0x446f])까지 각도를 재서 지금 차체각과의 편차가 기량별 문턱 안이면
      // spreadOk 를 세운다. 처음에는 +0x74 로 옮겼다가 락스텝에서 탐침 인자가 갈려 잡았다
      // (devlog 115).
      let spreadOk = false;                                                     // [bp-0x2d] 의 초기 성분
      if (frontClear && A8((rec + 0x73) & 0xffff) !== 0xff && skill !== 3 &&
          A8((rec + 0x40) & 0xffff) === 0) {                                    // 0x0D35B..0x0D394
        const tgt = A8((rec + 0x73) & 0xffff);
        const tRecT = tRec(tgt);
        const ty = sd16(A32((tRecT + 0x0d) & 0xffff), 50), tx = sd16(A32((tRecT + 0x09) & 0xffff), 50);
        const oy = sd16(baseY, 50), ox = sd16(baseX, 50);
        const lockAngle = angleBetween(ox, oy, tx, ty);                          // 0x0D433..0x0D439
        const curDeg = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);
        const spread = Math.abs(lockAngle - curDeg);                             // 0x0D43B..0x0D48E
        const threshold = (skill === 1 ? 2 : 0) + (skill === 2 ? 4 : 0) + (skill >= 4 ? 2 : 0);
        if (spread <= threshold) {                                               // 0x0D4C9..0x0D4CD
          spreadOk = true;
          // 문턱 안이고 기량>=4 이고 inv[1](+0x4A)==4 가 아니면: 차체 정면(4배)에서
          // 표적까지 한 번 더 탐침해 막혀 있으면 spreadOk 를 내린다.
          // 여기서 si 는 차체 각이 아니라 방금 잰 표적 방향(도 단위, 0x0D439 mov si,ax)이다. 원본은
          // 그 값을 1/50도 단위를 받는 사인·코사인에 그대로 넘긴다. 셋째 색은 표적(+0x73)의 색이다.
          if (skill >= 4 && A8((rec + 0x4a) & 0xffff) !== 4) {                   // 0x0D4DA..0x0D4FC
            const fx2 = i32(baseX + imul16(i16(cosine(lockAngle)), 4));          // 0x0D4FC..0x0D526
            const fy2 = i32(baseY + imul16(i16(sine(lockAngle)), 4));            // 0x0D529..0x0D553
            const hit2 = host.probe({                                            // 0x0D5F5, c1=15·c2=8 로 뒤바뀐 순서
              x1: sd16(fx2, 50), y1: sd16(fy2, 50), x2: tx, y2: ty,
              count: 3, c1: 0xf, c2: 8, c3: A8((0x126f + sbyte(tgt)) & 0xffff),   // 0x0D556..0x0D56C
            }             ) & 0xff;
            if (hit2 !== 0xff) spreadOk = false;                                 // 0x0D5FB..0x0D5FF
          }
        }
      }

      let frontOwner = 0, rearOwner = 0;                                       // [bp-0x2f] [bp-0x30]
      if (frontColour !== 0) frontOwner = sbyte(A8((COLOUR_OWNER + frontColour) & 0xffff)); // 0x0D609..0x0D613
      if (rearColour !== 0) rearOwner = sbyte(A8((COLOUR_OWNER + rearColour) & 0xffff));    // 0x0D61C..0x0D626

      // 팀 모드: 표식(음수 소유자)·같은 편 탱크로 짚힌 색은 지운다. 자기 팀
      // 표식으로 짚히면 정지하고 90도 옆으로 틀고, 다른 표식이면 그냥 정지.
      if (A8(S_TEAM) !== 0 && !(frontColour === 0 && rearColour === 0)) {       // 0x0D629..0x0D63F
        const ownTeam = A8((rec + 0x03) & 0xffff);
        if (frontOwner < 0) {                                                   // 0x0D651
          if (-frontOwner === ownTeam) {                                        // 0x0D65F
            frontColour = 0;                                                    // 0x0D686
            wA8((rec + 0x04) & 0xffff, 0);                                      // 0x0D695
            const cd = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);
            wA16((rec + 0x6d) & 0xffff, idivr(cd + 0x5a, 0x168));               // 0x0D6A5..0x0D6C5 +90도
          } else {
            wA8((rec + 0x05) & 0xffff, 0);                                      // 0x0D66F 정지
            wA8((rec + 0x04) & 0xffff, 0);                                      // 0x0D67F
          }
        }
        if (rearOwner < 0 && -rearOwner === ownTeam) rearColour = 0;            // 0x0D6C9..0x0D6DC
        if (frontColour > 0 &&                                                   // 0x0D6E0
            A8((TANK_BASE + frontOwner * TANK_STRIDE + 0x03) & 0xffff) === A8((rec + 0x03) & 0xffff))
          frontColour = 0;                                                       // 0x0D708
        if (rearColour > 0 &&                                                    // 0x0D70C
            A8((TANK_BASE + rearOwner * TANK_STRIDE + 0x03) & 0xffff) === A8((rec + 0x03) & 0xffff))
          rearColour = 0;                                                        // 0x0D734
      }
      // +0x62(실드/순간이동 점멸) 도는 탱크로 짚히면 지운다.
      if (rearColour !== 0 && A16((TANK_BASE + rearOwner * TANK_STRIDE + 0x62) & 0xffff) !== 0)
        rearColour = 0;                                                          // 0x0D738..0x0D750
      if (frontColour !== 0 && A16((TANK_BASE + frontOwner * TANK_STRIDE + 0x62) & 0xffff) !== 0)
        frontColour = 0;                                                         // 0x0D754..0x0D76C

      // ── 터렛 조준 — 진짜 문턱(0x0D770..0x0D8E4). doc 은 "기량∈{2,4,5} && +0x40!=0"
      // 라고 적었고 이건 맞다. **2c 는 여기서 "+0x13 을 쓰고 viable 을 재는 건
      // 기량>=4 뿐이다" 라고 적었는데 이것은 2c 자신의 오독이었다** — 3b 시험
      // (turret-gate-skill2-writes, 3b 보고 참고)으로 잡혔다: [bp-0x27](기량) 재검사가
      // 0x0D770..0x0D782 문턱 하나뿐이고, +0x13 을 쓰는 자리(0x0D8E0)도 아래 viable
      // 계산도 기량 2·4·5 가 똑같이 밟는다 — 기량으로 갈리는 곳이 없다.
      //
      // [bp-0x36](viable) 도 2c 는 "문턱이 막히면 스택 찌꺼기라 정적으로 못 정한다"
      // 고 적었는데, 이것도 오독이었다 — 3b 가 두 필러(0/1)로 실제로 떠서 잡았다
      // (viable-residue 경우, 3b 보고 참고: 씨앗이 두 경우에서 완전히 같게 나와
      // 0x0DB3E 자체가 한 번도 안 불린 것으로 확인됐다). 문턱이 막히면(기량 not in
      // {2,4,5}) 0x0D782 의 `jmp 0xdb6a` 가 **0x0DB3E(아래 50/50 절)보다 뒤로**
      // 뛴다 — 그 자리를 통째로 건너뛰어 읽지도 않는다. 문턱이 열리면 0x0D7BB 가
      // 어떤 경로로도 읽기 전에 먼저 0 으로 누른다. 그래서 [bp-0x36] 가 "함수 호출
      // 전 찌꺼기"로 읽히는 경로 자체가 없다 — false(0) 시작은 추측이 아니라
      // 두 경로 모두에서 맞는 값이다.
      // 셋째 조건은 자기 +0x62 가 아니라 표적(+0x74)의 +0x62 다 (0x0D7A5..0x0D7B1). 처음에는 자기 것으로
      // 옮겼다가 락스텝 robots_destroyer_30r_v1 에서 잡았다 (devlog 117).
      let viable = false;                                                        // [bp-0x36]
      if ((skill === 2 || skill === 4 || skill === 5) &&
          A8((rec + 0x40) & 0xffff) !== 0 &&
          A16((tRec(A8((rec + 0x74) & 0xffff)) + 0x62) & 0xffff) === 0) {       // 0x0D770..0x0D7B8
        const di = A8((rec + 0x74) & 0xffff);                                    // 0x0D7CB
        let tx        , ty        ;
        if (A8((rec + 0x73) & 0xffff) !== 0xff) {                                // 0x0D7DD
          const tRecT = tRec(di);
          ty = sd16(A32((tRecT + 0x0d) & 0xffff), 50); tx = sd16(A32((tRecT + 0x09) & 0xffff), 50);
        } else {
          const team = A8((rec + 0x03) & 0xffff);
          const mk = (MARK_BASE + ((3 - team) << 5)) & 0xffff;
          ty = A16((mk + 2) & 0xffff); tx = A16(mk);                             // 판 단위(이미 /50 눈금)
        }
        const oy = sd16(baseY, 50), ox = sd16(baseX, 50);
        const turretAim = angleBetween(ox, oy, tx, ty);                          // 0x0D89E
        const curDeg = idivq(i16(A16((rec + 0x11) & 0xffff)), 50);
        wA16((rec + 0x13) & 0xffff, idivr(turretAim + 0x168 - curDeg, 0x168) * 50); // 0x0D8B2..0x0D8E0

        // 3b 시험으로 잡음: 기량 2 도 여기까지 그대로 온다 — [bp-0x27] 재검사가
        // 0x0D770..0x0D782 문턱 하나뿐이라 아래 viable 계산에 기량 갈림이 없다.
        if (sdiv(i32(lmul(3, u32(draw()))), 0x8000) === 0) viable = true;        // 0x0D8E4..0x0D91C
        else if (A8((rec + 0x73) & 0xffff) === 0xff) viable = true;

        // viable 을 좁힌다: +0x73 가 있으면 거리(같은 /300 눈금, 32비트 그대로)가
        // 7000 을 넘거나 시야가 막히면 내린다. +0x73==0xFF(팀 표식) 면 자기 위치에서
        // 표식까지 시야가 막히면 내린다(c2 는 팀별 표 0x127B 값 — 의미 미상).
        // 거리 검사는 +0x73 과 상관없이 [+0x74] 탱크까지 잰다(0x0D921..0x0D9C1 이 0x0D9DA 갈림보다 앞).
        // 처음에는 +0x73 != 0xFF 갈래 안에 두었다가 락스텝 팀전 기록에서 잡았다 (devlog 118).
        {
          const dxr = sdiv(i32(A32((tRec(di) + 0x09) & 0xffff) - baseX), 300);   // 0x0D928..0x0D953
          const dyr = sdiv(i32(A32((tRec(di) + 0x0d) & 0xffff) - baseY), 300);   // 0x0D959..0x0D98B
          const D = i32(lmul(u32(dxr), u32(dxr))) + i32(lmul(u32(dyr), u32(dyr))); // 0x0D991..0x0D9B7
          if (D > 0x1b58) viable = false;                                        // 0x0D9BA 7000
        }
        if (viable) {
          if (A8((rec + 0x73) & 0xffff) !== 0xff) {                              // 0x0D9DA
            {
              const hit = host.probe({                                          // 0x0DA77
                x1: ox, y1: oy, x2: sd16(A32((tRec(di) + 0x09) & 0xffff), 50), y2: sd16(A32((tRec(di) + 0x0d) & 0xffff), 50),
                count: 3, c1: 8, c2: A8((SLOT_COLOUR + sbyte(di)) & 0xffff), c3: ownColour,
              }             ) & 0xff;
              if (hit !== 0xff) viable = false;                                  // 0x0DA7D..0x0DA81
            }
          } else {                                                               // 0x0DA89 — 팀 표식
            const team = A8((rec + 0x03) & 0xffff);
            const teamColour = A8((COLOUR_TEAM_TABLE + (3 - team)) & 0xffff);
            const hit = host.probe({                                            // 0x0DB2F
              x1: ox, y1: oy, x2: tx, y2: ty,
              count: 3, c1: 8, c2: teamColour, c3: ownColour,
            }             ) & 0xff;
            if (hit !== 0xff) viable = false;                                    // 0x0DB35..0x0DB39
          }
        }
      }

      // ── 50/50 규칙 배정(0x0DB44..0x0DB6A) ────────────────────────────────
      // viable 이면 동전을 던져 규칙 B(spreadOk) 나 규칙 C(frontColour) 문턱을 강제로
      // 세운다 — 어느 쪽이든 이미 서 있으면 그대로 둔다(내리는 방향은 없다).
      let ruleBGate = spreadOk, ruleCGate = frontColour !== 0;
      if (viable) {                                                              // 0x0DB3E
        if (sdiv(i32(lmul(2, u32(draw()))), 0x8000) !== 0) ruleBGate = true;      // 0x0DB44..0x0DB60
        else ruleCGate = true;                                                    // 0x0DB66
      }

      // ── 무기 사슬(0x0DB6A..0x0DFB3) ───────────────────────────────────────
      chain: {
        // 재고 칸 오프셋: inv[n] = +0x49+n (기준 0x43FC). 아래에서 직접 쓴다 — 2c
        // 작성 중 처음엔 0x4400 기준으로 잘못 빼서 inv[1..7] 이 넷 어긋났었다.
        // (파이썬으로 다시 빼서 잡음: inv1=0x4A, inv2=0x4B, inv3=0x4C, inv4=0x4D,
        //  inv6=0x4F, inv7=0x50.)

        // 규칙 A — ruleAGate(bp-0x28, 2b 가 넘김): inv[7]==42(순간이동 자기) &&
        // rand()*5/32768==0 → 무기 7.
        if (ruleAGate && A8((rec + 0x50) & 0xffff) === 0x2a) {                    // 0x0DB7C..0x0DB92
          if (sdiv(i32(lmul(5, u32(draw()))), 0x8000) === 0) {                    // 0x0DB94..0x0DBB6
            wA8((rec + 0x34) & 0xffff, 7);                                        // 0x0DBC5
            fire(); break chain;                                                   // 0x0DBCA
          }
        }

        // 규칙 B — ruleBGate: inv[4] && rand()*3/32768!=0 → 1 | inv[2] → 4 |
        // inv[1] → 2(기량>=4 && inv[1]==4 면 그냥 반환).
        if (ruleBGate) {                                                           // 0x0DBCD
          if (A8((rec + 0x4d) & 0xffff) !== 0 &&                                   // 0x0DBE1 inv[4]
              sdiv(i32(lmul(3, u32(draw()))), 0x8000) !== 0) {                     // 0x0DBE8..0x0DC0A
            wA8((rec + 0x34) & 0xffff, 1);                                         // 0x0DC19
          } else if (A8((rec + 0x4b) & 0xffff) !== 0) {                            // 0x0DC2B inv[2]
            wA8((rec + 0x34) & 0xffff, 4);                                         // 0x0DC3D
          } else if (A8((rec + 0x4a) & 0xffff) !== 0) {                            // 0x0DC4F inv[1]
            wA8((rec + 0x34) & 0xffff, 2);                                         // 0x0DC61
            if (skill >= 4 && A8((rec + 0x4a) & 0xffff) === 4) break fireDone;     // 0x0DC66..0x0DC7E 반환
          }
          if (A8((rec + 0x34) & 0xffff) === 3 && A8((rec + 0x40) & 0xffff) !== 0) { // 0x0DC8C..0x0DCA3
            const half = idivq(i16(A16((rec + 0x13) & 0xffff)), 2);                // 0x0DCB0..0x0DCC1
            wA16((rec + 0x13) & 0xffff, idivr(half + 0x1194, 0x2328) * 2);         // 0x0DCC3..0x0DCD2
          }
          fire(); break chain;                                                     // 0x0DCD6
        }

        // 규칙 C — ruleCGate: 기량>=3 && inv[2] → 2 | inv[1] → 1 | inv[4]!=0
        // && inv[4]!=29 && (탱크 Y % 2)==0 → 4(doc 에 없던 짝수 조건, 0x0DD52 확인).
        if (ruleCGate) {                                                           // 0x0DCD9
          if (skill >= 3 && A8((rec + 0x4b) & 0xffff) !== 0) {                     // 0x0DCE2..0x0DCF8 inv[2]
            wA8((rec + 0x34) & 0xffff, 2);                                         // 0x0DD05
          } else if (A8((rec + 0x4a) & 0xffff) !== 0) {                            // 0x0DD17 inv[1]
            wA8((rec + 0x34) & 0xffff, 1);                                         // 0x0DD29
          }
          const inv4 = A8((rec + 0x4d) & 0xffff);                                  // inv[4]
          if (inv4 !== 0 && inv4 !== 0x1d) {                                       // 0x0DD39..0x0DD50
            // 원본이 32비트 Y(+0x0D) 를 통째로 0x011E5(smod) 에 넘긴다 — 워드만
            // 자르면 안 된다(표를 자르지 않는다). 원본은 `or ax,dx ; je` 로 32비트
            // 나머지 전체가 0 인지 본다("나머지==1" 이 아니라 "나머지!=0"). smod 가
            // u32 로 접어 내므로 음수 나머지도 0 이 아니게 나온다(smod(-5,2)=
            // 4294967295, smod(-4,2)=0, 직접 재서 확인) — 그래서 `=== 0` 하나로
            // 음수 좌표에서도 원본과 그대로 맞는다.
            if (smod(u32(A32((rec + 0x0d) & 0xffff)), 2) === 0)
              wA8((rec + 0x34) & 0xffff, 4);                                       // 0x0DD52..0x0DD80
          }
          if (A8((rec + 0x34) & 0xffff) === 3 && A8((rec + 0x40) & 0xffff) !== 0) { // 0x0DD90..0x0DDA7
            const half = idivq(i16(A16((rec + 0x13) & 0xffff)), 2);                // 0x0DDB4..0x0DDC5
            wA16((rec + 0x13) & 0xffff, idivr(half + 0x1194, 0x2328) * 2);         // 0x0DDC7..0x0DDD6
          }
          fire(); break chain;                                                     // 0x0DDDA
        }

        // 규칙 D — rearColour: inv[3] → 3, +0x13=0, 쏘고 기량!=4 면 반환.
        if (rearColour !== 0) {                                                    // 0x0DDDD
          if (A8((rec + 0x4c) & 0xffff) !== 0) {                                   // 0x0DDEE inv[3]
            wA8((rec + 0x34) & 0xffff, 3);                                         // 0x0DE00
            wA16((rec + 0x13) & 0xffff, 0);                                        // 0x0DE10
            fire();                                                                 // 0x0DE1C
            if (skill !== 4) break fireDone;                                       // 0x0DE20..0x0DE26
          }
        }

        // 규칙 E — inv[7]==39 && +0x81<15 && +0x26>75 && +0x22<400-기량*30 → 7,
        // +0x81++, 쏜다(반환 없이 규칙 F 로 이어진다).
        if (A8((rec + 0x50) & 0xffff) === 0x27 && A8((rec + 0x81) & 0xffff) < 0xf &&
            A8((rec + 0x26) & 0xffff) > 0x4b &&
            i16(A16((rec + 0x22) & 0xffff)) < 0x190 - skill * 0x1e) {              // 0x0DE34..0x0DE7C
          wA8((rec + 0x34) & 0xffff, 7);                                           // 0x0DE89
          wA8((rec + 0x81) & 0xffff, (A8((rec + 0x81) & 0xffff) + 1) & 0xff);       // 0x0DE99
          fire();                                                                   // 0x0DEA3
        }

        // 규칙 F — 교전 표적이 없으면 rand()*40/32768!=0 일 때 반환.
        if (A8((rec + 0x7b) & 0xffff) === 0xff &&                                  // 0x0DEB2
            sdiv(i32(lmul(0x28, u32(draw()))), 0x8000) !== 0) break fireDone;       // 0x0DEB9..0x0DEDD

        // 규칙 G — +0x26>40 && inv[7]==40 → 7, 쏜다.
        if (A8((rec + 0x26) & 0xffff) > 0x28 && A8((rec + 0x50) & 0xffff) === 0x28) { // 0x0DEED..0x0DF04
          wA8((rec + 0x34) & 0xffff, 7);                                            // 0x0DF11
          fire();                                                                    // 0x0DF1C
        }

        // 규칙 H(doc 에 없던 자리, 0x0DF20..0x0DFB3) — 탱크 X·Y(원시 좌표)가 둘 다
        // 홀수이고 inv[5](+0x4E)이 비지 않았고 기량>=3 이면 동전을 던져 반이면
        // 무기 5 로 쏜다. 아니면 모두 반환. **재고 칸을 잘못 짚었던 자리 — 3b 에서
        // rule-H 경우가 실제로 안 물어서 원본을 다시 재 잡았다(감독 확인).
        // [bx+0x444a] 는 0x444a-0x43fc=0x4e 라 inv[1](+0x4A)이 아니라 inv[5] 다 —
        // "무기 5 를 재고에 갖고 있나" 를 뜻으로도 맞는 재고 칸.**
        // "==0" 이 원본의 `or ax,dx;je`(32비트 나머지 전체가 0인지)와 음수에서도
        // 맞는 이유는 규칙 C 의 Y-짝수 검사 옆 주석 참고 — smod 가 u32 로 접는다.
        if (smod(u32(A32((rec + 0x09) & 0xffff)), 2) === 0) break fireDone;          // 0x0DF20..0x0DF41 X 짝수
        if (smod(u32(A32((rec + 0x0d) & 0xffff)), 2) === 0) break fireDone;          // 0x0DF43..0x0DF64 Y 짝수
        if (A8((rec + 0x4e) & 0xffff) === 0) break fireDone;                        // 0x0DF66..0x0DF76
        if (skill < 3) break fireDone;                                              // 0x0DF78..0x0DF7C
        if (sdiv(i32(lmul(2, u32(draw()))), 0x8000) !== 0) break fireDone;          // 0x0DF7E..0x0DF98
        wA8((rec + 0x34) & 0xffff, 5);                                              // 0x0DFA5
        fire();                                                                      // 0x0DFB0
      }
    }

    // TAIL(0x0DFB4..0x0DFD5): 사슬 전후로 무기 번호가 달라졌으면 상태판 다시 그림.
    if (A8((rec + 0x34) & 0xffff) !== weaponBefore) host.statusPanel(1, p);       // 0x0DFC6..0x0DFD4
  }
  flushSeed();
}
