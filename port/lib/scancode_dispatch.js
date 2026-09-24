// @원본 0x0AEE3
//
// scancodeToPlayerInput(0x0AEE3) — 0x0AEB8(port/lib/keyboard.ts)이 채운 스캔코드 링을
// 최대 세 사람의 탱크 입력 바이트로 번역한다. 게임 루프(0x0AC29)가 링 쓰기 색인
// (0x4D90)이 0 이 아닐 때만 부른다.
//
// ── 필드 ────────────────────────────────────────────────────────────────────
//   0x4D90         링에 쌓인 스캔코드 개수. 이 함수가 끝나면 0 으로 지운다.
//   0x4D91..       링 바이트열. 실제 항목은 0x4D92 부터고(0x4D91 은 마지막 항목의
//                  사본), 순서는 si=1..[0x4D90]. keyboard.ts 의 `KeyRing.at` 과 같은
//                  자리이지만, 꼬리(아래)의 부호 있는 색인이 링 앞쪽 너머 다른 DGROUP
//                  바이트까지 읽을 수 있어 여기서는 작은 전용 배열이 아니라 dg 전체를
//                  그대로 쓴다.
//   0x4D62         (disasm/data_0x4D62.md 가 확정) 라운드 종료 모드 선택자. 0 이면
//                  Esc(스캔코드 1)가 라운드를 끝낸다.
//   0x4D66         라운드 종료 사유 바이트. Esc 는 2 를 쓴다.
//   0x4D73         참가자 수. 안쪽 루프가 p<3 이고 sbyte([0x4D73])>p 인 동안 돈다(부호
//                  있게 — 홀드아웃으로 잡힌 정정, 아래 참조).
//   0x4D47         플레이어별 9바이트 키 표(보폭 9): forward, backward, rotate_left,
//                  rotate_right, turret_left, turret_right, turret_center,
//                  change_weapon, fire. 플레이어 0 도 슬롯 0 을 갖는다(아래 참조).
//   탱크+0x00      0 이면 그 자리가 사람(입력을 받는다). 0 이 아니면(로봇) 이 함수는
//                  그 플레이어를 완전히 건너뛴다.
//   탱크+0x4400/+0x4401/+0x4402  전진/회전/터렛 축. 바이트, -1/0/1(터렛은 0/1/2).
//   탱크+0x4403    발사 래치. **워드**로 쓴다(원본이 그렇다).
//   탱크+0x443C    터렛 관문. 0 이면 터렛 키를 아예 안 본다.
//   탱크+0x447C    이 판에 이 사람이 키를 실제로 줬다는 표시(아래 참조).
//   0x4CC0(+p*0x15) 기량/오토파일럿 배열. +0x00 이 0 이면 사람 자리(analysis/match_setup.md).
//
// ── note 정정 (2026-09-05, 정적 재확인 — 문서를 안 믿고 바이트를 끝까지 따라갔다) ──
// 기존 note 는 "플레이어 0 = 하드코딩, 1·2 = 표" 라고 적었다. **틀렸다.** 플레이어 0 도
// 하드코딩 스캔코드 전부가 안 맞으면 똑같이 0xB027 의 공유 표 디스패치(슬롯 0)로
// 떨어진다. change_weapon 호출(0x121E2)은 실제로 자리 하나(0x0AF3A)이고, 하드코딩
// PgUp 경로(player=0 고정)와 공유 표 경로(player=현재 루프 색인)가 그 자리를 공유한다.
//
// 또 하나: **플레이어 0 전용 하드코딩 눌림에는 축 게이트가 없다.** 표 기반 눌림
// (forward/backward/rotate)은 "그 축이 이미 0 일 때만" 받는데(0xB164/0xB1C1), 플레이어
// 0 의 하드코딩 상하좌우(0x48/0x50/0x4D/0x4B)는 이 게이트 없이 늘 덮어쓴다. 뗌은 둘 다
// 게이트가 있다(눌려 있을 때만 지운다).
//
// ── 부호 있는 자리 셋 (원본 그대로 옮김, 고치지 않음) ────────────────────────────
// · 링 개수(0x4D90)를 바깥 루프 경계에서 **부호 있게** 비교한다(`cwde` 뒤 `cmp`). 0x80
//   이상이면 음수로 꺾여 루프가 통째로 안 돈다. keyboard.ts 의 필러가 같은 바이트에
//   대해 이미 "그대로 둔다" 고 적은 것과 같은 성질이지만 이 비교는 별개 코드다.
//   hold-out 대상이었다 — 원본과 대조해 정답표에 넣었다(아래 goldens 참조).
// · **참가자 수(0x4D73)도 부호 있게 비교한다**(`cbw` 뒤 `cmp`, 0xB30E). 처음 옮길 때
//   `Math.min(2, count-1)` 로 다시 써서 부호를 잃었다 — 값이 정상 범위(0..6)일 때는
//   결과가 같아서 정답표 12경우로는 안 걸렸는데, hold-out 이 `[0x4D73]=0x80` 을 넣어
//   보고서야 갈렸다(원본은 즉시 나가고, min() 표현은 count-1=127 로 커져서 돈다).
//   **무엇이 잡았나: hold-out.** 원본의 두 비교(`p<3`, `sbyte(count)>p`)를 그대로 두
//   비교로 옮겨 고쳤다 — 1단계는 다시 쓰지 않고 그대로 옮기는 것이다.
// · 표 기반 뗌 판정(예: forward 의 뗌 스캔코드)도 부호 있는 16비트로 계산한다
//   (`cwde` 뒤 `add ax,0xff80`). 표 값이 0x80 이상이면 이 계산이 **어떤 스캔코드로도
//   맞을 수 없는 값**이 나온다 — 부호 확장된 바이트의 치역은 0x0000..0x007F 이거나
//   0xFF80..0xFFFF 뿐인데 표 값이 0x80 이상이면 결과가 그 치역 밖으로 난다. 즉 그 축의
//   뗌이 영원히 안 걸린다. 원본 그대로 옮긴다.
//
// ── 꼬리(0xB2E2..0xB301) — 정리됨 ────────────────────────────────────────────
// 탱크+0x447C=1 은 "이 판에 이 사람이 키를 실제로 받았다" 는 표시다. 게임 루프
// (0x0AC29, 0xADA6)의 라운드 종료 경로가 이것과 탱크+0x00==0(원래 사람 자리)을 같이
// 보고, 사람 자리인데 447C 가 0(이번 판에 키를 한 번도 안 줌)이면 0x4CC0[p]+0x00 을
// 0x4D77(설정값)로 덮어 다음 판부터 오토파일럿에게 넘긴다 — 자리비운 사람을 로봇이
// 대신 몰게 하는 장치로 보인다. 4CC0[p]+0x00=탱크+0x00 쓰기는 이 경로에 들어오는
// 전제가 이미 탱크+0x00==0 이라 **언제나 0 을 다시 쓸 뿐이다** — match_setup.md 가
// 이미 적어 둔 사실(기량 레코드 +0x00 = 탱크 레코드 +0x00)의 무해한 중복이다.
//
// 소리(0x02914/0x02940, player-0 up 키에서 삑)는 DGROUP 흔적이 없는 하드웨어 부수효과라
// host.beep(hz) 콜백으로 뺀다 — 골든이 못 보는 자리다.
//
// 바이트 근거는 disasm/addr_0x0AEE3.md. port/test/scancode_dispatch.test.ts 가 원본이
// 낸 정답표로 판정한다.

import { changeWeapon,                 } from "./weapon.js";

const u16 = (v        )         => v & 0xffff;
const sbyte = (v        )         => (v << 24) >> 24;

const TANK_BASE = 0x43fc, TANK_STRIDE = 0x176;
// 아래는 전부 탱크 기저(TANK_BASE) 기준 상대 오프셋이다 — base(=TANK_BASE+p*STRIDE)에
// 더해서 쓴다. 어셈블리의 `[bx+0x4400]` 류는 bx=player*0x176(TANK_BASE 안 더함)이라
// 상수 자체가 이미 플레이어 0 절대주소다; 여기서는 TANK_BASE 를 뺀 상대값으로 옮겼다.
const ELIGIBLE = 0x00; // tank+0x00 -- 0 = 사람 자리
const AXIS_FWD = 0x04, AXIS_ROT = 0x05, AXIS_TURRET = 0x06;
const FIRE = 0x07; // 워드로 쓴다
const TURRET_GATE = 0x40;
const GAVE_INPUT = 0x80; // 이 판에 실제로 키를 받았다
const AUTOPILOT = 0x4cc0, AUTOPILOT_STRIDE = 0x15;

const KEY_TABLE = 0x4d47, KEY_STRIDE = 9;
const K_FWD = 0, K_BACK = 1, K_ROTL = 2, K_ROTR = 3,
      K_TURL = 4, K_TURR = 5, K_TURC = 6, K_WEAPON = 7, K_FIRE = 8;

const RING_COUNT = 0x4d90, RING_BASE = 0x4d91;
const ROUND_MODE = 0x4d62, ROUND_END = 0x4d66, PLAYER_COUNT = 0x4d73;
const REASON_QUIT = 2;

                               
                           
                     
                                                     
                         
 

function writeWord(dg            , at        , v        )       {
  dg[u16(at)] = v & 0xff;
  dg[u16(at + 1)] = (v >> 8) & 0xff;
}

/** 부호 있는 16비트 뗌 판정: 원본의 `cwde; add ax,0xff80` 를 그대로 옮긴 것. */
function releaseMatches(scancode        , pressCode        )          {
  return sbyte(scancode) === sbyte(pressCode) - 0x80;
}

/** 표 기반 디스패치(0xB027..). 플레이어 0 은 하드코딩이 안 맞을 때 이것도 시도한다. */
function tryTable(dg            , host              , base        , player        , scancode        )          {
  const tbl = u16(KEY_TABLE + player * KEY_STRIDE);
  const T = (i        )         => dg[u16(tbl + i)];

  if (scancode === T(K_WEAPON)) { changeWeapon(host.weapon, dg, player); return true; }
  if (scancode === T(K_FIRE)) { writeWord(dg, u16(base + FIRE), 1); return true; }
  if (releaseMatches(scancode, T(K_FIRE))) { writeWord(dg, u16(base + FIRE), 0); return true; }

  if (dg[u16(base + TURRET_GATE)] !== 0) {
    if (scancode === T(K_TURL)) { dg[u16(base + AXIS_TURRET)] = 0xff; return true; }
    if (scancode === T(K_TURR)) { dg[u16(base + AXIS_TURRET)] = 1; return true; }
    if (scancode === T(K_TURC)) { dg[u16(base + AXIS_TURRET)] = 2; return true; }
    if (releaseMatches(scancode, T(K_TURL)) || releaseMatches(scancode, T(K_TURR))) {
      dg[u16(base + AXIS_TURRET)] = 0;
      return true;
    }
  }
  if (dg[u16(base + AXIS_FWD)] === 0) {
    if (scancode === T(K_FWD)) { dg[u16(base + AXIS_FWD)] = 1; return true; }
    if (scancode === T(K_BACK)) { dg[u16(base + AXIS_FWD)] = 0xff; return true; }
  }
  if (dg[u16(base + AXIS_ROT)] === 0) {
    if (scancode === T(K_ROTL)) { dg[u16(base + AXIS_ROT)] = 0xff; return true; }
    if (scancode === T(K_ROTR)) { dg[u16(base + AXIS_ROT)] = 1; return true; }
  }
  if (dg[u16(base + AXIS_FWD)] !== 0) {
    if (releaseMatches(scancode, T(K_FWD)) || releaseMatches(scancode, T(K_BACK))) {
      dg[u16(base + AXIS_FWD)] = 0;
      return true;
    }
  }
  if (dg[u16(base + AXIS_ROT)] !== 0) {
    if (releaseMatches(scancode, T(K_ROTL)) || releaseMatches(scancode, T(K_ROTR))) {
      dg[u16(base + AXIS_ROT)] = 0;
      return true;
    }
  }
  return false;
}

/** 플레이어 0 전용 하드코딩(0xAF2F..0xB026). 안 맞으면 호출부가 tryTable 로 떨어뜨린다. */
function tryPlayer0Hardcoded(dg            , host              , base        , scancode        )          {
  if (scancode === 0x49) { changeWeapon(host.weapon, dg, 0); return true; }
  if (scancode === 0x47) { writeWord(dg, u16(base + FIRE), 1); return true; }
  if (scancode === 0xc7) { writeWord(dg, u16(base + FIRE), 0); return true; }
  if (scancode === 0x48) { dg[u16(base + AXIS_FWD)] = 1; host.beep(100); return true; }
  if (scancode === 0x50) { dg[u16(base + AXIS_FWD)] = 0xff; return true; }
  if (scancode === 0x4d) { dg[u16(base + AXIS_ROT)] = 1; return true; }
  if (scancode === 0x4b) { dg[u16(base + AXIS_ROT)] = 0xff; return true; }

  if (dg[u16(base + TURRET_GATE)] !== 0) {
    if (scancode === 0x4f) { dg[u16(base + AXIS_TURRET)] = 0xff; return true; }
    if (scancode === 0x51) { dg[u16(base + AXIS_TURRET)] = 1; return true; }
    if (scancode === 0x4c) { dg[u16(base + AXIS_TURRET)] = 2; return true; }
    if (scancode === 0xcf || scancode === 0xd1) { dg[u16(base + AXIS_TURRET)] = 0; return true; }
  }
  if (dg[u16(base + AXIS_FWD)] !== 0) {
    if (scancode === 0xc8 || scancode === 0xd0) { dg[u16(base + AXIS_FWD)] = 0; return true; }
  }
  if (dg[u16(base + AXIS_ROT)] !== 0) {
    if (scancode === 0xcd || scancode === 0xcb) { dg[u16(base + AXIS_ROT)] = 0; return true; }
  }
  return false;
}

/** 0x0AEE3. dg 는 64KiB DGROUP. 반환값 없음. */
export function scancodeToPlayerInput(host              , dg            )       {
  const count = sbyte(dg[RING_COUNT]); // 0x0AEEA..0x0B31B, 부호 있게

  for (let si = 1; si <= count; si++) {
    const scancode = dg[u16(RING_BASE + si)]; // 0x0AEF0

    if (dg[ROUND_MODE] === 0 && scancode === 1) dg[ROUND_END] = REASON_QUIT; // 0x0AEF7..0x0AF05

    // 0xB308/0xB30E — 원본은 "p<3 이고 sbyte([0x4D73])>p 인 동안" 두 비교로 돈다.
    // min(2,count-1) 으로 다시 쓰면 부호가 없어진다 — 참가자 수가 0x80 이상이면 원본은
    // 즉시 나가는데(sbyte 가 음수) 그 표현은 count-1(=127)로 커져서 돈다. 홀드아웃으로
    // 잡힌 정정이라 원본의 두 비교를 그대로 둔다.
    for (let p = 0; p < 3 && sbyte(dg[PLAYER_COUNT]) > p; p++) {
      const base = u16(TANK_BASE + p * TANK_STRIDE);
      if (dg[u16(base + ELIGIBLE)] !== 0) continue; // 0x0AF1C — 로봇 자리는 건너뜀

      const matched = p === 0
        ? tryPlayer0Hardcoded(dg, host, base, scancode) || tryTable(dg, host, base, 0, scancode)
        : tryTable(dg, host, base, p, scancode);

      if (matched) {
        dg[u16(base + GAVE_INPUT)] = 1; // 0xB2E2
        dg[u16(AUTOPILOT + p * AUTOPILOT_STRIDE)] = dg[u16(base + ELIGIBLE)]; // 0xB2F1..0xB301, 언제나 0
      }
    }
  }

  // 0xB326..0xB333 — 마지막 항목을 앞으로 복사하고 개수를 지운다. 부호 있게 색인하므로
  // count 가 음수면 링 앞쪽 너머의 다른 DGROUP 자리를 읽는다 — 그대로 둔다.
  dg[RING_BASE] = dg[u16(RING_BASE + sbyte(dg[RING_COUNT]))];
  dg[RING_COUNT] = 0;
}
